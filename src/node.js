#!/usr/local/bin/node
'use strict';

/*
* @module uniSoc
* @author plundell
* @license Apache2
* @description Backend component of uniSoc providing server, dgram and ipc
*	
* @extends ./unisoc-common.js 	See it for dependencies
*
* @exports function({dependencies}) 	It exports a function which should be run with it's dependencies,
*										which in turn returns an object with 4 constructor functions.
*
*
* TODO 2019-11-12: if underlying connection, eg wifi, is cut before we close the socket, what happens? emit
*					an event on this or log something...
*
* @emits
*		_connect 	A client has connected. Emitted by clients and servers
*		_disconnect A client has disconnected. Emitted by clients and servers
*		_listen  	A server is listening for incomming connections. Emitted by servers only
*		_unlisten 	A server has stopped listening for incomming connections. Emitted by servers only
*		_first 		Each time server's number of clients go from 0 to 1
*		_last 		Each time server's number of clients go from 1 to 0
*/
module.exports=function export_uniSoc_node(dep={}){

	function missingDependency(which){throw new Error("Missing dependency for uniSoc: "+which);}

	/*
	* @const object cX 		BetterUtil common utilities
	*/
	var cX= dep.cX || dep.util || dep.BetterUtil  || missingDependency('BetterUtil');
	cX=cX.cX || cX 
	dep.BetterUtil=cX;


	/*
	* @const constructor uniSoc 	A common parent for both nodejs and browser flavor
	*/
	const uniSoc = dep.uniSoc || dep.common || require('./common.js')(dep);
	



	/*
	* @const object fs 		Native filesystem class, used to check if the socket file already exists (eg. on account 
	*						of a failed exit), and remove it so a new socket can be setup
	*/
	const fs = dep.fs || require('fs');


	/*
	* @const object net 	Native net class, used to create client and server socket objects
	*/
	const net = dep.net || require('net');


	/*
	* @const object dgram 	Native dgram class, used for udp sockets
	*/
	const dgram = dep.dgram || require('dgram');


	/*
	* @const object cp 		Native child_process class, used when proxying a child process over unisoc
	*/
	const cp = dep.cp || require('child_process');






	//returned at the bottom
	const _exports={
		'dgram':uniSoc_dgram
		,'Client':uniSoc_net //unlike uniSoc_ws, _net can be used on it's own... so we export is as 'Client'
		,'Server':uniSoc_Server
		,'IPC':uniSoc_IPC
	};






	/*
	* NOTE: Since udp is stateless it can function both as a server and client, ie. it can send and receive 
	*		messages to/from multiple remote hosts, therefore it has both server and client methods, eg. 
	*			connect() - creates a socket that can send
	*			listen() - listens for incoming messages on that socket
	*/
	function uniSoc_dgram(options){

		//Extract options meant for socket ('type' may cause issues elsewhere, other than that
		//there probably is no need)
		var socOptions=cX.extract(options||{},['type','reuseAddr','ipv6Only','recvBufferSize'
			,'sendBufferSize','lookup'],true);

		//Call the uniSoc constructor as 'this', which sets a few things on this incl log
		uniSoc.Client.call(this,options);

		/*
		* @prop boolean connected		True if a socket that can send exists
		*/
		Object.defineProperty(this,'connected',{enumerable:true,get:()=>this.socket?true:false})


		//Setup this.socket. (This should be called after calling parent)
		this.connect(options);


		/*
		* @prop number listening	UDP port socket is listening for incomming messages on. 0 => not listening
		*/
		this.listening=0;
		
		/*
		* @prop object linfo 		Local address used by socket, or empty object
		*/
		Object.defineProperty(this,'linfo',{enumerable:true,get:()=>this.socket ? this.socket.address() : {}})


		



	}
	uniSoc_dgram.prototype=Object.create(uniSoc.Client.prototype); 
	Object.defineProperty(uniSoc_dgram.prototype, 'constructor', {value: uniSoc_dgram}); 





	/*
	* This method should have it's 2 first args bound by parseArgs() and then inclulded on 
	* the object passed to the send/request on __proto__
	*
	* @return Promise(true|<BLE>) 	Already logged via this.sentLog

	* @bind(this,number,string|undefined)
	*/
	function transmit_dgram(port,address,obj){
		var objBuff=Buffer.from(JSON.stringify(obj));
		
		var {promise,callback}=cX.exposedPromise();
		this.socket.send(objBuff,0,objBuff.length, port, address, callback); //callback is called with error or void
		return promise.then(//resolves/rejects when callback^^ is called
			()=>this.afterTransmit(null,obj,address,port) //returns true
			,err=>this.afterTransmit(err,obj,address,port) //returns rejected BLE
		); 
	}


	/*
	* Args passed to send() and request() can be either a single object (allows for more args), or
	* passed "inline". See function body for order of "inline" args.
	*
	* @param array args 	
	*
	* @return obj 	
	* @call(<uniSoc_dgram>)		
	*/
	function parseDgramArgs(args){
		if(args.length==1 && typeof args[0]=='object' && args[0].hasOwnProperty('subject'))
			var obj=args[0];
		else
			obj={
				callback:cX.getFirstOfType(args,'function',true)
				,subject:args.shift() //First non-function
				,port:args.pop() //last non-function
				,address:args.pop() //next-to-last non-function
				,data:(args.length==1 ? args[0] : !args.length ? undefined : args) //the rest
			}

		//Now make sure we have a valid port, and optionally an address (default 127.0.0.1)...
		var dest=Object.assign(cX.extract(obj,'rinfo')||{},cX.extract(obj,['ip','hostname','host','address','port'],true));
		//...then use them to create a _transmit method
		obj._transmit=transmit_dgram.bind(this,validatePort.call(this,dest.port),dest.address||dest.host||dest.hostname||dest.ip);

	//NOTE 2019-11-06: We could just as well do this in transmit_dgram...let's try it at some point, that way it can be renamed to _transmit()
	//					for uniformity

		return obj;
	}


	/*
	* Send a UDP message without expecting response
	*
	* NOTE: calls uniSoc.send() (ie. parent method with same name)
	*
	* @see parseArgs for arguments
	*
	* @return Promise(void,err) 	Resolves when sending finishes, rejects with send error	
	*/
	uniSoc_dgram.prototype.send=function(...args){
		try{
			if(!this.connected)
				this.log.makeError('Not connected, cannot send. Please call this.connect()').throw('COMMANDS_OUT_OF_ORDER');
			args=parseDgramArgs.call(this,args);
			var promise=uniSoc.prototype.send.call(this,args);				
		}catch(err){
			promise=Promise.reject(err);
		}
		return promise.catch(err=>this.log.makeError('Failed to send dgram',err).reject())	
	}

	/*
	* Send a UDP message which is expecting a response
	*
	* NOTE: calls uniSoc.send() (ie. parent method with same name)
	*
	* @see parseArgs for arguments
	*
	* @return Promise 			If @callback is passed in, a promise that resolves when the request has been sent
	*						      ,else a Promise that resolves when response is received and rejects otherwise
	*/
	uniSoc_dgram.prototype.request=async function(...args){
		try{
			if(!this.connected)
				this.log.makeError('Not connected, cannot send. Please call this.connect()').throw('COMMANDS_OUT_OF_ORDER');
			args=parseDgramArgs.call(this,args);
			await this.listen();
			var promise=uniSoc.prototype.request.call(this,args); //yes call, not apply, we're passing an object				
		}catch(err){
			promise=Promise.reject(err);
		}
		return promise.catch(err=>this.log.makeError(err).addHandling('Failed to request via dgram').reject())
	}





	/*
	* Register to receive AND send multicast messages
	*
	* @param string mcastAddr 	A multicast address to register on
	*
	* @return Promise(void,err)
	* @async
	*/
	uniSoc_dgram.prototype.registerMulticast=function(mcastAddr,...listenArgs){
		return Promise.resolve()
			.then(()=>cX.checkType('string',mcastAddr))
			.then(()=>this.listen.apply(this,listenArgs))
			.then(()=>{
				this.log.info("Registering for multicast on",mcastAddr);
				this.socket.addMembership(mcastAddr);
				return;
			})
	}


	/*
	* Listener for dgrams messages that parses unisoc data and passes it on to uniSoc.receive()
	*
	* @bind(<uniSoc_dgram>)
	*/
	function onDgram(buffer,rinfo){
		try{
			var str=buffer.toString();
			var from=`from ${rinfo.address}:${rinfo.port}`;
			var obj = JSON.parse(str);
			if(obj.__uniSoc){
				//Any prop we set on obj here will be included by receive() when it calls downstream handlers, so we
				//include rinfo...
				obj.rinfo=rinfo;
				//...that way if this is a request, this.send() know where to send the response, and if this is a 
				//response/message, the caller/listener will know who sent it
				return this.receive(obj);
			}else
				this.log.warn(`Received non-uniSoc dgram containing JSON ${from}:`,obj);
		} catch(err){
			this.log.error(`Received bad JSON ${from}:`,err,str);
		}
	}

	uniSoc_dgram.prototype.connect=function(options){
		if(this.connected){ //a socket exists and is not closed
			return false;
		}else{
			
			this.socket = dgram.createSocket(Object.assign({type:'udp4'},options));
			
			this.socket.on('close',()=>{
				this.listening=0;
				this.emit('_disconnect'); //TODO 2019-11-05: Add ability to include error, like with Client
			})

			this.log.debug("Created new UDP socket")

			// this.emit('_connect');
			//2019-11-14: I think we shouldn't emit '_connect' since it entails that a new client has connected, which
			//			  does apply since we ARE a client too, but since this can work as a server maybe it will be
			//			  misleading... 
			return true;
		}
		
	}

	/*
	* @param number port
	* @param @opt string addr  			Optional local address to listen on. Necessary if going to receive multicast
	* @param @opt function optCallback  If given this function returns void
	*
	* @return Promise(number,BLE) 	Resolves with the port we're listening to
	*/
	uniSoc_dgram.prototype.listen=function(port){
		try{
			var {resolve,reject,promise}=cX.exposedPromise();
			if(this.listening){
				if(port && this.linfo.port!=port){
					this.log.throw(`Cannot listen on port ${port}, already listening on ${this.linfo.port}`)
				}else{
					return Promise.resolve(this.linfo.port);
				}
			}

			//Bind to a local port, optionally a local address (suitable if more than one iface exists)
			port=(port ? validatePort.call(this,port) : 0);
			var addr=cX.getFirstOfType(arguments,'string');
			this.socket.bind(port,addr);

			this.socket.on('message',onDgram.bind(this));

			this.socket.on('listening',()=>{
				var a=this.socket.address();
				this.listening=a.port;
				this.log.info(`UDP server listening on ${a.address}:${a.port}`)
				resolve(this.listening);
			})

			this.socket.on('error',err=>{
				if(!this.listening){
					reject(err);
				}else{
					this.log.makeError(err).addHandling("Error on UDP socket, shutting it down...").exec();
				}
				this.socket.close();
			})
			
		}catch(err){
			log.error(err);
			reject(err);
		}
		promise.catch(err=>this.log.makeError(err)
			.addHandling(`Failed to listen on UDP port ${port}`).reject());

		var cb=cX.getFirstOfType(arguments,'function');
		if(cb){
			promise.then(
				data=>cb(null,data)
				,err=>cb(err)
			)
			return;
		}else{
			return promise;
		}
	}

	/*
	* Stop listening and close socket. After this you have to call .connect() before sending again
	*
	* @return Promise
	*/
	uniSoc_dgram.prototype._kill=function(){
		var {callback,promise}=cX.exposedPromise();
		if(this.connected)
			this.socket.close(callback);
		else
			resolve();
		
		return promise;
	}
















	/*
	* Used for 'ws' sockets 
	*
	* NOTE: Unlike browser where we my try to reconnect by creating a new socket, here sockets are generated by 
	*		ws-server and passed to this this constructor by clientConnectionHandler, ie. the socket given
	*		is the only one we'll ever have in this instance
	*/
	function uniSoc_ws(socket,options){
		//Call the uniSoc constructor as 'this', which sets a few things on this incl log
		uniSoc.Websocket.call(this,Object.assign({},uniSoc_ws.defaultOptions,options));

		//Set socket and register all listeners. 
		this.socket=socket;
		this.registerAllListeners();


		// this.rinfo={}		

		//Unlike the browser, clients on the server need to keep the connection alive by pinging the browser...
		var alive=true; //start with true, else first interval will fail
		//A 'pong' is the response to a 'ping'. It should have the same data. Every time it arrives we set 
		//set the alive flag to true (which is checked before each new ping goes out)
		this.socket.addEventListener('pong', ()=>{     
			// this.log.highlight('blue','got pong...');
        	alive=true;
    	});
    	var pingInterval
		var startPinging=()=>{
			this.log.trace(`Pinging client at ${this.options.pingInterval} ms interval`)
			pingInterval=setInterval(()=>{
				try{  
		            if(!alive){
		            	//If the client hasn't responded since last ping was sent out, it means he's
		            	//already dead and gone, so just forcibly close the connection
		            	this.log.note("Client unreachable (ping didn't return)...")
		            	this.kill();
		            }else{
		                //set flag to false (which will be re-set to true by pong^^ an checked next interval^)
		                alive=false; 
		                // this.log.highlight('green','sending ping...');
		                this.socket.ping()
		            }
		        }catch(err){
		            this.log.makeError(err).prepend("ping interval:").exec();
		        }
			},this.options.pingInterval);
		};
		this.after('_connect',startPinging);
		this.once('_disconnect',function stopPingingClient(){clearTimeout(pingInterval)}); 

	}
	uniSoc_ws.prototype=Object.create(uniSoc.Websocket.prototype); 
	Object.defineProperty(uniSoc_ws.prototype, 'constructor', {value: uniSoc_ws}); 



	uniSoc_ws.defaultOptions={
		pingInterval:30000
	}



















	function uniSoc_net(...args){
		var name=cX.getFirstOfType(args,'string',true)
		var socket=cX.getFirstOfType(args,net.Socket,true);
		var options=cX.getFirstOfType(args,'object',true)||{};
		if(name)
			options.name=name;
		//Call the uniSoc constructor as 'this', which sets a few things on this incl log
		uniSoc.Client.call(this,options);
		
		//If an existing socket was passed in, use that, else you'll have to call .connect() at some point
		if(socket){
			this.log.debug("Wrapping around existing socket");
			this.socket=socket;
			this.handleSocketEvents(); //will emit _connect
		}

		Object.defineProperty(this,'connected',{enumerable:true,get:()=>this.socket && !this.socket.pending})

		this.after('_connect',()=>{
			try{
				if(options.keepAlive)
					this.socket.setKeepalive(true, Number(options.keepAlive)||10000)
				
				this.rinfo={address:this.socket.remoteAddress,port:this.socket.remotePort}

				this.log.info('Connected to: ',cX.stringifySafe(this.rinfo));
			}catch(err){
				this.log.makeError(err).prepend('BUGBUG: ').exec();;
			}
		});
		
		
	}
	uniSoc_net.prototype=Object.create(uniSoc.Client.prototype); 
	Object.defineProperty(uniSoc_net.prototype, 'constructor', {value: uniSoc_net}); 

	uniSoc_net.prototype._kill=function(){


		//2019-09-12: end() only sends a FIN packet, ie. stopping us from writing, but the other
		//			  side can keep writing thus keeping the socket open. We do currently have
		//			  both sides set to allowHalfOpen=false which automatically sends a FIN packet
		//			  back which ends the connection... but just to be sure we destroy() which sends
		//			  FIN the closes both reading/writing without waiting for the other to respond
		//			  with FIN.
		if(this.socket)
			this.socket.destroy();
	}

	/*
	* Turn an object into a string, append EOM and send over a net.Socket
	*
	* @return Promise
	* @call(this)
	*/
	uniSoc_net.prototype._transmit=function netSend(obj){
		//Turn it into a JSON string and append it with the end-of-message string
		var objStr=JSON.stringify(obj);
		objStr+=this.EOM;

		var {promise,callback}=cX.exposedPromise();
		
		this.socket.write(objStr,callback); //callback is called with error or void and will 
											//cause @promise to resolve/reject
		
	//TODO 2019-11-07: this should probably be moved to afterTransmit which we can rename afterSend
		return cX.thenCallback(promise,(err,data)=>{
				//To facilicate bash script with nc client to disconnect after response
				setTimeout(()=>{
					if(obj.disconnectAfterSend){
						this.log.trace("option disconnectAfterSend triggered"); 
						this.kill();
					}
				},1)//timeout so it runs after log vv
				
				return this.afterTransmit(err,obj)
			}
		)
	}	



	/*
	* NOTE: This method does NOT need to be called for new client sockets on a uniSoc_Server, it is only
	*		useful if creating a uniSoc_net manually and connecting to a another server
	*
	* @throws TypeError
	* @return Promise(void,err)
	*/
	uniSoc_net.prototype.connect=function(options){

		var {promise,resolve,reject}=cX.exposedPromise();

		cX.checkType('object',options);

		var hostStr,host=cX.extract(options,['ip','hostname','host','address','server']);
		if(typeof options.path =='string'){
			validateUnixSocket.call(this,options.path, true); //true=socket should exist. will throw error on fail
			hostStr=options.path;

		} else if(typeof options.port=='number'){
			validatePort.call(this,options.port); //will throw error on fail

			//Make sure we have a host as well, else default to localhost
			options.host=Object.values(host).find(x=>typeof x=='string');
			switch(typeof options.host){
				case 'undefined':
					options.host='localhost'; //default
				case  'string':
					//all good
					break;
				default:
					this.log.throwType("options.host to be a string",options.host);
			}
			hostStr=options.host+':'+options.port;

		} else{
			this.log.makeError("You have to specify either path or port, got:",options).throw("ERR_MISSING_ARGS")
		}


		this.log.trace("About to connect using: ",cX.stringifySafe(options))
		var throwConnectionError=true; 
		var self=this;
		this.socket = net.createConnection(options)

		this.once('_connect',()=>{
			throwConnectionError=false;
			resolve();
		});
		
		
		//If we've set a timeout, destroy the socket with an arg which will fire the 'error' event like normal
		if(options.connectTimeout){
			setTimeout(function onConnectTimeout(){
				if(throwConnectionError){
					throwConnectionError=false;
					self.socket.destroy({code:'ECONNTIMEOUT'});
				}
			},options.connectTimeout)
		}

		//If disconnect happens before connect....eeeeerror
		this.once('_disconnect',function onDisconnect(err){
			if(throwConnectionError){
				throwConnectionError=false;
				if(!err)
					err=self.log.makeError("No error event fired... what happened?");

				if(err.code=='ECONNTIMEOUT')
					err.addHandling(`Timed out after ${options.connectTimeout} ms.`)

				err=self.log.error("Failed to open connection to "+hostStr,err);

				if(err.code=='ECONNREFUSED')
					self.log.warn("Check that the server is running and that you have the right address");

				reject(err);
			}
		})

		//Add listeners for all relevant events on the socket
		this.handleSocketEvents();


		return promise;

	}


	/*
	* Handles various events on a socket, re-emitting on this or calling this.receive() etc.
	*
	* @param object options
	*/
	uniSoc_net.prototype.handleSocketEvents=function(){

		if(!(this.socket instanceof net.Socket))
			this.log.throw("Expected this.socket to be a <net.Socket>. It was: ",this.socket);


		var self=this;

		//The 'error' event doesn't necessarily mean the socket will close, but if it does the 'close(true)' 
		//event will fire after 'error', which we listen for vv
		//NOTE 2019-09-12: manually emitting 'error' on this/Client will cause an exception to be thrown unless 
		//			       someone is listening for it... so we don't re-emit the errors here instead we let
		//				   'close' include it via lastError vv
		var lastError=null;
		this.socket.on('error', function onError(err) {
			lastError=self.log.error(err);
		});
		

		//'end' is emitted when FIN packet is received (ie. when other side TELLS US it closed it's writing pipe). 
		//Since neither client nor server is allowing half open connections, this means that the other party will 
		//automatically  send FIN back, which practically means the connection is closed after this, but since it's
		//all predicated on the other side telling us, it's not reliable... we instead wait for the 'close' vv
		this.socket.on('end',function onEnd(){
			var msg="Received FIN packet (ie. other side closed writing pipe)"
			if(self.socket.allowHalfOpen){
				//We cannot know when the other side stops listening, but we know there will be no more incoming
				//messages, so the only reason to stay connected is if there is a pending request (and after that
				//it'll be time to disconnect). If we don't disconnect we'll have a bunch of half open sockets with
				//nobody on the other end which misleading (especially if we want to check if there are any clients
				//connected, eg. if we have to keep showing some info or if we can go dormant)
				if(self.receivedRequests.length){
					self.log.note(msg+", but allowHalfOpen==true and we're still working on "+self.receivedRequests.length
						+" requests, so socket will remain open until they finish");
					
					self.once('_waiting',()=>{
						self.log.debug("All responses sent and already received FIN, so disconnecting...")
						self.kill();
					})
				}else{
					self.log.debug(msg+" and there are no pending requests, so socket will now close");
				}


			}else{
				self.log.debug(msg+" and allowHalfOpen==false so socket will now close");
			}
		})



		//'close' will be emitted
		this.socket.on('close', function onClose(hadError) {
			self.log.trace("Socket closed");
			if(hadError && !lastError)
				lastError=self.log.error("'close' event fired with error==true, but no error found");

			self.emit('_disconnect',lastError);
		})

		




		var cachedData="";

		/*
		* @event data 			Event handler for net.Socket ONLY. Calls receive() when full object received.
		*
		* @param string chunk 	The raw string read from the socket
		*/
		this.socket.on('data',chunk=>{
			// self.log.info('Got chunk: ',chunkStr);
			if(chunk){
				//Turn the data into a string and append it to cachedData 
				let chunkStr = chunk.toString();
				if(typeof chunkStr=='string'){
					cachedData+=chunkStr;
				} else {
					self.log.error("IPC client expected server to send something that "+
						"could be turned into a string, got a "+typeof chunk);
					return;
				}
			}

			//Now, regardless if any new data was received, check the total cachedData for a end-of-message string...
			let i=cachedData.indexOf(self.EOM); 
			if(i>-1){
				//...if found, extract everything before it, leaving the rest in the cache 
				let objStr=cachedData.substring(0,i);
				cachedData=cachedData.substring(i+self.EOM.length);
				try{
					var obj = JSON.parse(objStr);
				} catch(err){
					let msg=err.message.replace('SyntaxError:','')
					self.log.note("Received badly formated JSON:",msg,'\n',objStr);
					self.send("SyntaxError",Promise.reject("Could not parse incomming message. "+msg))
					return
				}
				
				self.receive(obj)
			}
		});

		// this.once('_connect',()=>{console.log('THE SOCKET HAS JUST CONNECTED:\n',this.socket)})

		//Make sure we emit a _connect event on the uniSoc
		if(this.socket.pending)
			this.socket.on('connect',()=>{this.emit('_connect');});
		else{
			this.emit('_connect');
		}
	}









	//TODO 2019-11-13
	/*
	* Emulates a client that can connect to a local server where we have direct access to said 
	* server. Removes overhead but still allows us to acheive "same handling" for local and
	* remote clients
	*/
	function uniSoc_LocalClient(){

	}

































	/*
	* A uniSoc Server collects underlying servers and clients from those servers. It allows sending and 
	* receiving to/from all those clients
	*/
	function uniSoc_Server(options){
		//Call the uniSoc constructor as 'this', which sets a few things on this incl log
		uniSoc.call(this,options);

		/*
		* @prop <Map> underlying 	Keys are instances of 'net.Socket' servers or 'ws' servers, values are 
		*							one of those strings
		*/
		this.underlying=new Map();


		Object.defineProperty(this,'listening',{enumerable:true,get:()=>{
			var listening=false;
			this.underlying.forEach((type,server)=>{
				if(type=='net'){
					if(server.listening){
						listening=true;
					}
				}else if(typeof server.listening=='boolean'){
					if(server.listening)
						listening=true;
				}else{
					//For a regular ws we don't have a good way to determine listening yet, just assume it is
					listening=true;					
				}
			})
			return listening;
		}});


		
		/*
		* @prop object clients 	Keys are numerical client ids, values are <uniSoc_net> or <uniSoc_ws>
		*/
		this.clients={};


		
		//When a specific server stops listening...
		this.on('_unlisten',(server)=>{

			//Remove all clients associated with that server
			Object.entries(clients).forEach((id,client)=>{
				if(client.server==server){
					delete this.clients[id];
				}
			})

			//Remove that server
			this.underlying.delete(server);
		})



		/*
		* @prop object groups 	Keys are group subjects, values are arrays of ids of clients that are part 
		*						of that group
		*
		* NOTE: You can broadcast to a group by using broadcast2()
		*/
		this.groups={}


		//Register methods to allow clients to subscribe/unsubscribe
		this.registerEndpoint('subscribe',this.subscribeToGroup
			,{callAs:this,description:"Start receiving messages broadcast to a group-subject"});
		this.registerEndpoint('unsubscribe',this.unsubscribeFromGroup
			,{callAs:this,description:"Stop receiving messages broadcast to a group-subject"});


		Object.defineProperty(this,'length',{get:()=>Object.keys(this.clients).length});
	}
	uniSoc_Server.prototype=Object.create(uniSoc.prototype); 
	Object.defineProperty(uniSoc_Server.prototype, 'constructor', {value: uniSoc_Server}); 


	/*
	* Subscribe to group messages
	*
	* NOTE: When registered as endpoint, $unisoc will automatically set to the client unisoc
	*/
	uniSoc_Server.prototype.subscribeToGroup=function(group,unisoc){
		if(cX.checkTypes(['string',['number','object']],arguments)[1]=='object')
			unisoc=unisoc.id;

		if(!this.groups.hasOwnProperty(group)){
			this.groups[group]=[];
		}

		if(!this.groups[group].includes(unisoc)){
			this.groups[group].push(unisoc);
			// unisoc.on('_disconnect',unsubscribe.bind(this,group,unisoc));
				//^2020-03-02: Not necessary, done with unsubscribeClientFromAllGroups()
		}

		return;
	}


	/*
	* Unsubscribe from group messages 
	*
	* NOTE: When registered as endpoint, $unisoc will automatically set to the client unisoc
	*/
	uniSoc_Server.prototype.unsubscribeFromGroup=function(group,unisoc){
		if(cX.checkTypes(['string',['number','object']],arguments)[1]=='object')
			unisoc=unisoc.id;

		unsubscribe.call(this,group,unisoc)

		return;
	}

	/*
	* Unsubscribe a specific client from all group messages
	*
	* @param <uniSoc>|number 	A client instance or it's id on this server
	*
	* @return void
	*/
	uniSoc_Server.prototype.unsubscribeClientFromAllGroups=function(unisoc){
		if(cX.checkType(['number','object'],unisoc)=='object')
			unisoc=unisoc.id;

		Object.keys(this.groups).forEach(group=>unsubscribe.call(this,group,unisoc))

		return;
	}

	/*
	* @call(<uniSoc_Server>)
	* @private
	*/
	function unsubscribe(group,id){
		if(this.groups.hasOwnProperty(group)){

			cX.extractItem(this.groups[group],id);

			if(!this.groups[group].length){
				delete this.groups[group];
			}
		}
	}





	function getAddress(server){
		var info=server.address();
		if(typeof info=='string'){
			info={path:info};
		}else{
			info.host=info.address;
			delete info.address; //We call it 'host' because that's the option name when creating a net socket
		}
		return info;
	}



	/*
	* @param number|string|object
	*
	* @return string
	* @call(<uniSoc_Server>) For logging purposes only
	*/
	function addressType(x){
		switch(cX.varType(x)){
			case 'number':
				validatePort.call(this,x); //will throw error on fail
				return 'port';
			case 'string':
				validateUnixSocket.call(this,x, false); //false=socket should not exist, it will be created below
				return 'path';
			case 'object':
				//net.Socket  (yes Socket, not Server. Created with net.createConnection())
				if(x instanceof net.Socket || x.constructor.name=='Object'){
					return 'socket';
				}else if(typeof x.handleUpgrade=='function'){//We identify a ws-server by this method
					return 'ws';
				}else if(x.host){ //see getAddress() why we call it 'host' not 'address'
					validatePort.call(this,x.port); //will throw error on fail
					x.host=='localhost' || cX.validateIP(x.host);
					return 'host';
				}else if(x.port||x.path){
					return addressType.call(this,x.port||x.path);
				}
			default:
				this.log.throwType("port number, path string, options or Websocket.Server object",x);
		}
	}


	/*
	* Get an underlying server we're already listening to
	*
	* @return object|undefined 	An existing net.Socket server or ws.Server or undefined
	*/
	uniSoc_Server.prototype.getUnderlying=function(x){
		var t=arguments[1] || addressType.call(this,x),server;
		switch(t){
			case 'host':
				break; //continue below
			case 'socket':
				x=getAddress(x);
				if(typeof x!='string') break; //continue below
				t='path';
			case 'port':
			case 'path':
				this.underlying.forEach((info,_server)=>{
					if(info.type=='net' && info[t]==x){
						server=_server;
					}
				})
				return server;

			case 'ws':
				return this.underlying.has(x) ? x : undefined;

			default:
				return undefined;
		}

		//If we're still running we have a 'host'
		this.underlying.forEach((info,_server)=>{
			if(info.type=='net' && info.host==x.host && info.port==x.port){
				server=_server;
			}
		})
		return server;
	}


	

	/*
	* Initiate the server and start listening
	*
	* TODO 2019-11-13: Allow for listening on only certain addresses
	*
	* @throws ble.TypeError 	
	* @throws ble 				If we're already listening to something else
	*
	* @return Promise(object,err)
	*/
	uniSoc_Server.prototype.listen=function(x){
		let t= addressType.call(this,x);
		var server=this.getUnderlying(x,t)
		if(server){
			this.log.warn("Already called listen on: ",x);
			return Promise.resolve(server);
		}
		
		//This promise will be returned at bottom, unless x is a bad type, see vv
		var {resolve,reject,promise,inspect}=cX.exposedPromise(10000); 

		//Now depending on what we got as arg #1 either setup a new net/unix socket or a use an existing one
		var options=Object.assign({},this.options);
		switch(t){
			case 'port':
				options.port=x;
				options.host="0.0.0.0"; //default to ipv4 (instead of ipv6 which node prefers)
				createNetServer.call(this,options,resolve,reject);
				break;
			case 'path':
				options.path=x;
				createNetServer.call(this,options,resolve,reject);
				break;
			case 'socket':
				createNetServer.call(this,x,resolve,reject);
	//TODO: 2019-11-04: may need to handle differently depending on if it's already connected or not
				break;
			case 'ws':
				x.on('connection', clientConnectionHandler.bind(this,x))
				let info={type:'ws'};
				try{
					Object.assign(info,getAddress(x)); //throws in 'noServer' mode if we're not using our polyfill'd version
					this.log.info("Attaching WebSocket.Server which will listen on:",info);
					if(x.listening)
						resolve(x);
					else 
						x.on('listening',()=>resolve(x));
				}catch(err){
					this.log.info("Attached WebSocket.Server (NOTE: can't determine if we're listening)");
					resolve(x);
				}
				this.underlying.set(x,info);
				break;
			default:
				this.log.throwType("port number, path string, options or Websocket.Server object",x);
		}


		//Finally for some common handling
		return promise.then((server)=>{
			this.emit('_listen',server);

			//Same for both ws and net.Server are the close and error events, listen to them...
			server.on('close',()=>{
				this.emit('_unlisten',server);
			})	

			server.on('error', (err)=>{
				this.log.error('Underlying server emitted "error":',err);
			});

			return server;
		})


		
	}


	/*
	* @call(<uniSoc_Server>)
	*/
	function createNetServer(options,resolve,reject){
		var serverOptions=cX.extract(options,['allowHalfOpen','pauseOnConnect']);
		this.log.info("Creating new net server with options:",serverOptions);
		var server = net.createServer(serverOptions); 
		server.on('request',clientConnectionHandler.bind(this,server));
		
		server.listen(options,()=>{
			this.log.info('net server listening on '+JSON.stringify(server.address()));
			var info=getAddress(server)
			info.type='net';
			this.underlying.set(server,info)
			resolve(server);
		});	

		//Nothing will happen if we've already resolved
		server.on('error',(err)=>reject(this.log.makeError('Failed to listen:',err)))
	}
	

	



	/*
	* This method handles new connections from clients, for both net.Server or a socketIO.Server objects
	*
	* @param <net.Server>|<ws.Server> server 	The underlying server on which the socket was created
	* @param <net.Socket>|<ws.Socket> socket 	The newly created socket
	*
	* @call(<uniSoc_Server>)
	*/
	function clientConnectionHandler(server, socket){

		// log.info(who,server);
		//Create a unique id for the client
		var id = Math.floor(Math.random()*10000000);
		while(typeof this.clients[id]!=='undefined'){
			id+=1;
		}
		var options={id};

		this.log.info('Client '+id+' connected');

		//Create a new client and give it the socket
		let info=this.underlying.get(server);
		if(!info){
			this.log.throw("BUGBUG: the server doesn't exist among this.underlying:",server)
		}
		this.log.debug(`Underlying server is '${info.type}', wrapping newly connected socket in uniSoc_`
			+`${info.type=='ws' ? 'ws':'net'}()`);
		var client= (info.type=='ws' ? new uniSoc_ws(socket,options) : new uniSoc_net(socket,options))
		

		//Set a ref to the underlying server on the client, so we know which one it belongs to and can
		//remove it from this.clients when that underlying is removed/disconnects
		client.server=server;

		//2020-03-12: rinfo is only used by dgram... and this method doesn't handle dgram...
		//Intercept the receive() method to add rinfo
		// if(client.rinfo && client.rinfo.address){
		// 	client.receive=(obj)=>{obj.rinfo=client.rinfo; client.__proto__.receive.call(client,obj)}
		// }

	
		//Each client lives it's own life, but anything it can't do for itself this server will do for it 
		client.registerSharedEndpoints(this);
		Object.defineProperty(client,'onreject',{enumerable:true,configurable:true,get:()=>this.onreject});
		Object.defineProperty(client,'beforetransmit',{enumerable:true,configurable:true,get:()=>this.beforetransmit});
		Object.defineProperty(client,'aftertransmit',{enumerable:true,configurable:true,get:()=>this.aftertransmit});
		Object.defineProperty(client,'onresponse',{enumerable:true,configurable:true,get:()=>this.onresponse});
			//^these can be changed for individual sockets or for the server as a whole
		

		var onClientDisconnect=(err)=>{
			//Make sure errors get logged
			if(err)
				client.log.makeError(err).exec(); //will not dubble log

			//If we've already added the client (check in case there are some edge cases where _disconnect is emitted 
			//by a client even though it failed to emit '_connect' first
			if(this.clients.hasOwnProperty(id)){
				this.log.note('Client '+id+' disconnected');
				this.emit('_disconnect',id,err); //emit on server
				delete this.clients[id];
				if(this.length==0)
					this.emit('_last',id);
				this.unsubscribeClientFromAllGroups(id);
			}else{
				this.log.warn(`ESEQ: Client ${id} _disconnect event just fired, but client is not stored on this server`);
			}

			return 
		}
		client.once('_disconnect',onClientDisconnect);


		//As soon as the client connects... 
		var onClientConnect=()=>{
			//...it gets added to our list of clients
			this.clients[id]=client;
			
			//Now that we've done everything to setup the client on this object, let's let the
			//everybody know that we have a new client
			this.emit('_connect',id,client);

			//If we previously had no clients, emit that this is the first
			if(this.length==1)
				this.emit('_first',id,client);
		}
		client.after('_connect',onClientConnect,'once');

		return;
	}

		



	/*
	* Tell all clients to disconnect, then close all servers to new connections and delete it from this
	* item (in possible preperation for setting up a new server, which we may want to do without 
	* creating a new uniSoc as we may be listening to events on the uniSoc)
	*
	* @param mixed 	err 	Any variable to log as an error AND send (as a string representation)
	*						to all the clients when shuting down
	*
	* @return Promise 		A promise that resolves when all clients have disconnected
	* 						and the socket file is removed, else it's rejected
	*
	* @access public
	* @error_logged
	*/
	uniSoc_Server.prototype._kill = function(err,timeout=5000){
		return new Promise((resolve, reject)=>{
			try{
				if(!this.listening){
					this.log.info("Has the server already been shutdown? this.server==null")
					return resolve();
				}

				//If an error was passed in, log that, else just log a generic message
				let l=this.underlying.length
					msg='[uniSoc] Shutting down '+(l>1 ?`${l} underlying servers` : 'server')
				;
				if(err){
					this.log.error(msg+" because of error: ",err);	
				} else {
					this.log.info(msg)
				}
				
				//Tell all active clients to terminate their connection...
				if(!Object.getOwnPropertyNames(this.clients).length){
					this.log.info("No clients connected to server, exiting now.");
				} else {
					var strErr=String(err);
					for(let id of Object.getOwnPropertyNames(this.clients)){
						this.log.info("Telling client "+id+" to disconnect");
						this.clients[id].kill(strErr);
					}
				}

				//Then close servers to new connections...
				var proms=[];
				this.underlying.forEach((type,server)=>{
					let x=cX.exposedPromise();
					server.close(x.resolve);
					proms.push(x.promise);
				})

				//As soon as the last client disconnects resolve the promsie that this method has already returned
				cX.promiseTimeout(Promise.all(proms),timeout).then(
					function shutdown_success(){
						this.log.info("All clients have disconnected, exiting now.");
						resolve();
					}
					,function shutdown_fail(err){
						if(this.underlying.length){
							err=this.log.makeError("Failed to shutdown server within timeout.").setCode('timeout').exec();
							reject(err);
						}else{
							this.log.error(err);
							resolve();
						}
					}
				)
			} catch(err){
				reject(this.log.error("Failed to shutdown server properly",err));
			}

		})
	};


	uniSoc_Server.prototype.getClientId=function(client){
		var t=typeof client;
		if(t=='number'){
			if(this.clients.hasOwnProperty(client))
				return id;
		}else if(t=='object'){
			for(let id in this.clients){
				if(client===this.clients[id])
					return id;
			}
		}
		this.log.warn("Not a valid client:",String(client));
		return 0;
	}






	/*
	* @param array args 	All args passed to .broadcast()
	* 	@param string  	subject 	The subject of the message
	* 	@param function callback 	Callback function if responses are desired. Will be called 
	*													with (err,uniSoc,data)
	* 	@param mixed  	...data		The body of the message
	* 		-or-
	* 	@param object 				Props named as ^, plus:
	*		@opt 
	*
	* @throws <ble> 	If no subject is specified
	*
	* @return object{payload:object, clients:array, callback:function, exclude:uniSoc, group:string}
	*
	* @call(this) 	Used to access methods and props on this instance
	*/
	function parseBroadcastArgs(args){
		var obj;
		if(args.length==1 && typeof args[0]=='object'){
			var payload=args[0];

			
			obj=cX.extract(payload,['callback','group','exclude']);
				//'callback's are normally handled by .request() allowing for multiple responses, here it's used
				//for clients response (ie. handled by .broadcast() itself).
				
			//'group' is used to limit which clients we send to....
			if(obj.hasOwnProperty('group')){
				obj.clients=this.getGroupClients(obj.group);

				// ...it's also used as subject if none other is given
				if(!payload.subject)
					payload.subject=obj.group; 
			}


			obj.payload=payload;

		}else{
			obj={
				callback:cX.getFirstOfType(args,'function',true)
				,payload:{
					subject:args.shift() //First non-function
					,data:(args.length==1 ? args[0] : !args.length ? undefined : args) //the rest
				}
			}
		}

		//To prevent an error on every send, make sure we have a subject
		if(typeof obj.payload.subject!='string')
			this.log.throw("No subject specified for broadcast: ",obj.payload);

		//If no group was specified, then we send to all clients
		if(!obj.clients){
			obj.clients=Object.values(this.clients);
		}


		//If we're going to exclude someone (usually a client that sent a message that triggered the broadcast, or
		//one that we want to send something different/additional to), we just make sure it's a client object (as opposed
		//to the ID), that way we can easily extract it from obj.clients in broadcast() (done there not here for logging)
		if(obj.hasOwnProperty('exclude') && typeof obj.exclude=='number'){
			obj.exclude=this.clients[obj.exclude];
		}	

		return obj;
	}



	/*
	* Get all clients from a group
	*
	* @param string group
	* 
	* @return array[<uniSoc>]
	*/
	uniSoc_Server.prototype.getGroupClients=function(group){
		var clients=[],id;
		if(this.groups.hasOwnProperty(group)){
			for(id of this.groups[group]){
				if(this.clients.hasOwnProperty(id)){
					clients.push(this.clients[id]);
				}
			}
		}
		return clients;
	}



	/*
	* Send/request to all clients. @see parseBroadcastArgs() for params
	*
	* @return Promise(void,err|array)	Rejects with array of numbers, clients that we failed to send to, or error if
	*										something general went wrong
	* @access public
	*/
	uniSoc_Server.prototype.broadcast2=function(...args){
		try{
			this.log.traceFunc(arguments);
			//Parse args
			var {payload, clients, callback, exclude, group}=parseBroadcastArgs.call(this,args);

			//Remove an excluded client if any...
			var excludeStr=''
			if(exclude){
				excludeStr=` (excluding ${exclude.id})`
				cX.extractItem(clients,exclude);
			}

			//If no clients want the broadcast (because only one existed and she was excluded, or 
			//if we were trying to broadcast to a group with no members...)
			if(!clients.length){
				this.log.debug(`No clients to broadcast '${payload.subject}' to...${excludeStr}`);
				return Promise.resolve();
			}

			//Log
			var str='Broadcasting '
			let grpStr=`to group ${group} `
			if(group && group==payload.subject){
				str+=grpStr
			}else{
				str+=`'${payload.subject}' `
				if(group)
					str+=grpStr
			}
			str+=`to all ${clients.length} clients${excludeStr}`
			this.log.info(str);

			//Loop through all active clients and send them the same broadcast...
			var promises=[],client;
			for(client of clients){
				try{
					if(callback){
						promises.push(
							client.request.call(client,payload)
								.then(
									data=>callback(null,client,data)
									,err=>{callback(err,client); return Promise.reject(err)} //errors will be logged vv
								)
						)
					}else{
						promises.push(
							client.send.call(client,payload)
						);
					}
				}catch(err){
					promises.push(Promise.reject(err));
				}
			}

			//Wait for all promises to finish, logging errors as they come-up
			return cX.groupPromises(promises,this.log).promise
				.then(
					()=>{} //all went well. Any response data has already been passed to callback
					,()=>{
						//everything as been logged, and if callback existed they've been passed there as well along with 
						//the failing client... so here we just reject with an array of clients that will need extra handling

						//TODO 2020-03-02: this should return ^^
					}
				)

		}catch(err){
			return log.makeError('Failed to broadcast',err).reject();
		}
	}




























	/*
	* @param object procOrChild 	The running 'process' or a child_process
	*/
	function uniSoc_IPC(procOrChild,options){
		//Call the uniSoc constructor as 'this', which sets a few things on this incl log
		uniSoc.Client.call(this,options);

		if(typeof procOrChild.send!='function')
			this.log.throwType("child or process with IPC enabled",procOrChild);
		else
			this.socket=procOrChild;

		
		Object.defineProperty(this,'connected',{get:()=>this.socket && this.socket.send});

		/*
		* Receie an IPC message, check if a 'handle' was sent, and pass it on to uniSoc.receive()
		*
		* @param object obj
		* @param ?? handle 		A handle can eg. be a net.Socket or a child.stdout, and probably other stuff too. The
		*						defining fearture seems they have the method '_handle' (eg. child.stdout._handle), but
		*						it's the object itself you send (ie. child.stdout)
		*					https://nodejs.org/api/child_process.html#child_process_subprocess_send_message_sendhandle_options_callback
		* @return void
		*/
		var onMessage=(payload,handle)=>{
			if(payload.__uniSoc_child){
				//Since children arrive in pieces we can't let this.receive() be called until 
				//we've got them all, so it's done inside receiveChild()
				receiveChild(payload,handle);
			}else{
				if(handle)
					payload.data=handle;
				
				this.receive(payload)
			}
			return;

		}
		this.socket.on('message',onMessage);

		//TODO: this.connected, emit(disconnect)

		/*
		* @param object c 		One of the custom payloads sent by sendChild()
		* @param object handle 	
		*/
		var partialChildren={}
		var receiveChild=(customPayload,handle)=>{
			//NOTE: Sending happens async, so we can't be sure that the piece we sent first
			//      will arrive first... so we don't, instead we check what we got each time

			//First make sure we have an object locally stored where we can store all the
			//pieces while they come in. 
			var child,pid=customPayload.pid;
			if(!partialChildren.hasOwnProperty(pid)){
				//2019-10-27: It seems using ChildProcess works... but maybe we need to set more properties for it
				//            to really work... or maybe we shouldn't try to pass it off as a child since that may
				//			  cause unexpected runtime errors
				// child=partialChildren[pid]=Object.create(EventEmitter.prototype)
				child=partialChildren[pid]=Object.create(cp.ChildProcess.prototype)
				child.stdio=[null,null,null];
				child.pid=pid;
				child._pieces=1;
			}else{
				child=partialChildren[pid]
				child._pieces++; //count received pieces, will be deleted below
			}



			if(handle)
				child.stdio[customPayload.i]=handle
			else {
				//We're expecting the following props: pieces,endpoints,subject,payload

				child.pieces=customPayload.pieces; //expected pieces, will be deleted below
				child.payload=customPayload.payload; //the regular uniSoc payload, will be deleted below


				//Turn list of endpoints into proxy object. Said object will contain one nested object
				//which contains all the proxy-props from the child. Assign them to our local child
				let proxy=this.createProxyFromEndpoints(customPayload.endpoints)
				Object.assign(child,proxy[Object.keys(proxy)[0]]);

				//Finally listen to all the childs events that have been extended over the socket
				this.on(customPayload.subject,([evt,...args])=>child.emitEvent.call(p,evt,args));
			}
			

			//When we have all the expected pieces, do some last minute formating then call
			//the regular receive method
			if(child._pieces===child.pieces){
				delete partialChildren[pid];
				
				child.stdin=child.stdio[0];
				child.stdout=child.stdio[1];
				child.stderr=child.stdio[2];
				child.channel=child.stdio[3]; //double check this one

				//Now remove everything not part of child, then set child as data on the regular
				//payload and call the regular receive
				var {payload}=cX.extract(child,['payload','pieces','_pieces'])
				payload.data=child;
				this.receive(payload);
			}

			return
		}

	}
	uniSoc_IPC.prototype=Object.create(uniSoc.Client.prototype); 
	Object.defineProperty(uniSoc_IPC.prototype, 'constructor', {value: uniSoc_IPC}); 


	uniSoc_IPC.prototype._kill=function(){
		var {callback,promise}=cX.exposedPromise();
		this.socket.disconnect(callback);
		return promise;
	}


	/*
	* @return Promise(payload|err)
	*/
	uniSoc_IPC.prototype._transmit=function(payload){
		var {promise,callback}=cX.exposedPromise();


		//TODO 2019-10-10: Add ability to send more than just the handle, ie the handle
		//					could be one property on an object or array. also fix onMessage()
		if(payload.data instanceof cp.ChildProcess){
			this.sendChild(payload,callback)

		}else if(payload.data && typeof payload.data=='object' && payload.data._handle){
			//IPC can send objects with stream handles, @see onMessage()^^
			let handle=payload.data;
			payload.data=null; //don't really need to do this but since we overwrite data on receive it's clearer
			this.socket.send(payload,handle,callback);

		}else{
			this.socket.send(payload,callback);
		}

		return promise.then(()=>this.afterTransmit(null,payload),err=>this.afterTransmit(err,payload))
	};




	uniSoc_IPC.prototype.sendChild=function(payload,callback){
		try{
			//We can't send the child as regular data, so extract it from the payload, then place 
			//the rest of the payload as a sub-obj on the obj we'll actually be sending
			var child=cX.extract(payload,'data');
			var customPayload={payload:payload, __uniSoc_child:true, pid:child.pid};

			//We're going to send the child in pieces since we can only send 1 handle at a time, so
			//the total number of sends depends on how many stdio we have
			var pieces=child.stdio.filter(pipe=>pipe).length;

			//Then we need to add 1, sending of all the other stuff
			pieces+=1

			//Create a new callback that we can call each time we send a piece, but that calls the original
			//callback once everything is sent;
			var failed=false;
			var cb=(err)=>{
				if(err){
					failed=true;
					this.log.warn(`Failed to send part of child ${child.pid}.`,err);
				}

				if(--pieces==0){
					if(failed)
						callback(`Failed to send child ${child.pid}, see log^^`);
					else	
						callback()
				}
			}

			//First we want to send all but the handles, so start building that object
			customPayload.pieces=pieces

			//We want to register local endpoints for all non-handle props/methods on the child, 
			//but we: 
			//	 	a) don't want them to be listed among other endpoints so anyone can call them
			//	 	b) want to be able to register multiple children
			//So we need a random prefix, and we need to register them secretly (see this.registerEndpoint()):
			var subject=customPayload.subject=cX.randomString(32);
			var endpoints=cX.subObj(child,['connected','disconnect','kill','killed','ref','send','unref']);
			customPayload.endpoints=this.registerEndpointsForObject(endpoints,prefix,undefined,{_all:{secret:true}})

			//Extend all childs events over socket under a single subject (our random string)
			this.extendEvents(child,{subject});

			//....and send! That's 1...
			this.socket.send(customPayload,cb);


			//...now send all pipes, ie the stdio that !=null
			child.stdio.forEach((pipe,i)=>{
				if(pipe)
					this.socket.send({__uniSoc_child:true,pid:child.pid, i:i},pipe,cb);		
			})
		}catch(err){
			this.log.throw("Failed to send child over IPC:",child,err);
		}

	}




	    // Event: 'close'
	    // Event: 'disconnect'
	    // Event: 'error'
	    // Event: 'exit'
	    // Event: 'message'
	    // // subprocess.channel
	    // subprocess.connected
	    // subprocess.disconnect()  //only appears if IPC channel exists
	    // subprocess.kill([signal])
	    // subprocess.killed
	    // subprocess.pid
	    // subprocess.ref()
	    // subprocess.send(message[, sendHandle[, options]][, callback]) //only appears if IPC channel exists
	    // // subprocess.stderr
	    // // subprocess.stdin
	    // // subprocess.stdio
	    // // subprocess.stdout
	    // subprocess.unref()










	/*
	* Check if an unknown variable is a valid port number
	*
	* @param mixed port 	Any unknown variable
	*
	* @throws BLE
	* @return number 		The port
	* @access private
	* @call(this)
	*/
	function validatePort(port){
		if(typeof port !=='number'){
			this.log.makeError("Expected a port number, got:",this.log.logVar(port)).throw('TypeError');
		}else{
			//Make sure it's a valid port number and that we have enough permission to open it
			if(port<0 || port>65535){
				this.log.makeError("Port number "+port+" is not valid, select a number between 0-65535").throw('RangeError');
			}else if(port<1023 && !(process.getuid && process.getuid() === 0)){
				this.log.makeError("Ports under 1024 can only be bound by root, and we're not running as root").throw('PERMISSION_DENIED');
			}
		}
		return port
	}



	/*
	* @call(this)
	*/
	function validateUnixSocket(path, shouldExist){
		if(typeof path !=='string'){
			this.log.throwType("a path string",path);
		} else {
			if(fs.existsSync(path)){
				var stats=fs.statSync(path);
				if(stats.isSocket()){
					if(!shouldExist){
						this.log.note("Unix socket file already exists at "+path+", trying to remove it")
						fs.unlinkSync(path); //will throw error if it fails... I think, lets check just in case
						if(fs.existsSync(path))
							this.log.throw("Failed to delete existing unix socket");
					}
				} else {
					this.log.throw("The filepath exists but is not a unix socket");
				}

			} else if(shouldExist){
				this.log.throw("The unix socket path doesn't exist: "+path);
			}
		}
	}



	return _exports;
}

