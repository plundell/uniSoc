#!/bin/bash

# This script is meant to communicate with uniSoc.node.Server over a TCP or unix socket, allowing
# for eg. control of a running process

# @depends linux package 'jq'
#
# Exit statuses:
# 	0 Success (with or without response)
#	1 Error response
#	2 ENOENT Socket file missing
# 	(2 Misuse of shell builtins (according to Bash documentation)) 
#   13 EACCESS Socket file not readable or writable
#	22 EINVAL Invalid argument passed to this script
#	62 ETIME Command timed out
#   65 ENOPKG Missing dependency
#   88 ENOTSOCK Provided path is not a socket file
# 	160 Expected response, but none received
# 	161 Received unfinished response (ie. no EOM)
#	162 Received response when none was expected
# 	255 Bug in script

trap 'err_use_exit "Bug in script on line $LINENO" 255' ERR

EOM='__EOM__'
usage(){
	echo "Usage: $0 [OPTIONS] SOCKET_FILE SUBJECT [DATA...]]"
}
err_exit(){
	>&2 echo "$1"
	exit $2
}
err_use_exit(){
	>&2 echo "$1"
	>&2 echo ""
	>&2 usage
	exit $2
}

##Make sure we can read JSON
1>/dev/null which jq || (err_exit "ENOPKG: Please 'sudo apt install jq'" 65)


VERBOSE=""
EXPECT_RESPONSE=true
TIMEOUT=10 #default timeout is 10 seconds, just to prevent stalling

while getopts ":vqnt:h" opt; do 
	case ${opt} in
		v)
			VERBOSE=true
			;;
		q)
			exec 1>/dev/null 2>&1
			;;
		n)
			EXPECT_RESPONSE=""
			;;
		t)
			TIMEOUT="$OPTARG" 
			;;
		h)
			usage
			exit 0
			;;
		:)
			err_use_exit "Option -$OPTARG requires an argument" 1
      	;;	
  esac
done
shift $((OPTIND -1))




verbose_echo(){
	[ -z "$VERBOSE" ] || echo "$@"
}
verbose_printf(){
	[ -z "$VERBOSE" ] || printf "$@"
}


#Make sure we have enouch args
if [ "$#" -lt "2" ]; then
	err_use_exit "EINVAL: At least 2 args expected, got: $#" 22
fi



#Check that the target is a writable socket
SOCKET_FILE=$1
if [ -z "$SOCKET_FILE" ]; then
    err_use_exit "EINVAL: Arg #1 should be socket file path " 22
fi
if [ ! -e "$SOCKET_FILE" ]; then
    err_exit "ENOENT: $SOCKET_FILE" 2 #ENOENT, No such file or directory
fi
if [ ! -S "$SOCKET_FILE" ]; then
    err_use_exit "ENOTSOCK: $SOCKET_FILE" 88 #ENOTSOCK, Socket operation on non-socket
fi
if [ ! -w "$SOCKET_FILE" ]; then
	err_exit "EACCESS: You do not have write permission on socket file: $SOCKET_FILE" 13 #EACCES, Permission denied
fi
if [ ! -r "$SOCKET_FILE" ]; then
	err_exit "EACCESS: You do not have read permission on socket file: $SOCKET_FILE" 13 #EACCES, Permission denied
fi
shift 1






SUBJECT=$1
shift 1



isnumber(){
	local re='^[+-]?[0-9]+([.][0-9]+)?$'
	if [[ $1 =~ $re ]] ; then
	   return 0
	else
		return 1
	fi
}
isjson(){
	local re='^[\[\{]'
	if [[ ${1:0:1} =~ $re ]] ; then
	   return 0
	else
		return 1
	fi	
}
append(){
	if isnumber "$1" || isjson "$1" ; then
		DATA="$DATA$1"
	else
		DATA="$DATA\"$1\""
	fi
}

DATA=",\"data\":"
if [ "$#" == "1" ]; then
	append $1
elif [ "$#" -gt "1" ]; then
	#Multiple args gets put into an array.
	DATA="${DATA}["
	while (( "$#" )); do
		append $1
		shift
		(( "$#" )) && DATA="${DATA},"
	done
	DATA="${DATA}]"
else
	DATA=''
fi



# Build uniSoc packet
ID=$((1 + RANDOM % 1000000000))
MSG="{\"id\":$ID,\"disconnectAfterSend\":1,\"subject\":\"$SUBJECT\"$DATA}$EOM"
# MSG="{\"id\":$ID,\"subject\":\"$SUBJECT\"$DATA}$EOM" #works but uniSoc server needs to detect that we've left

verbose_echo "SENDING: $MSG"

#Send command to socket in subshell and redirect output to fd3. This allows 
#the script to continue while we receive the response
exec 3< <(echo "$MSG" | nc -U $SOCKET_FILE)

#If a timeout is specified, wait for output to start
START=$(date +%s)
verbose_printf "Waiting $TIMEOUT seconds for output:"
while true; do
	sleep 0.01
	read -t 0 <&3 && break
	verbose_printf '.'
	if (( TIMEOUT > 0 )); then
		NOW=$(date +%s)
		(( (NOW - START) > TIMEOUT )) && err_exit "ETIME: No response in $TIMEOUT seconds" 62
	fi
done
verbose_echo ""

#Read the response 1 character at a time, appending it to a variable and
#check if we've reached the end of the message
# 	-t 1  Timeout after 1 second (to prevent stalling if output stops)
#	-r 	  \ is part of the response, not an escape character
# 	-n1   read 1 character
#   char  Read into a variable called 'char'
BUFFER=""
while IFS="" read -t 1 -r -n1 char <&3 ; do
	BUFFER="$BUFFER$char"
	if [[ $BUFFER =~ __EOM__$ ]]; then
		RESPONSE=$(echo "$BUFFER" | sed -e "s/__EOM__//")
		exec 3>&- ##will this stall subshell or kill it
		break;
    fi
done
verbose_echo "RECEIVED: $BUFFER"

# Handle invalid or missing response
if [ -z "$RESPONSE" ]; then 
	if [ -n "$BUFFER" ]; then 
		err_exit "Received unfinished response (ie. no EOM)" 161
	fi
	if [ -z "$EXPECT_RESPONSE" ]; then
		verbose_echo "No response expected, none received"
		exit 0
	else
		err_exit "Expected response but none received" 160
	fi
fi


ERR=$(echo "$RESPONSE" | jq -r '.error')
DATA=$(echo "$RESPONSE" | jq -r '.data')


if [ "$ERR" == "null" ]; then
	if [ -z "$EXPECT_RESPONSE" ]; then
		>&2 echo "$DATA"
		err_exit "Received response when none was expected" 162
	else
		echo "$DATA"
		exit 0
	fi
else
	>&2 echo "$ERR"
	exit 1
fi





