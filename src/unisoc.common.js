//simpleSourceMap=/my_modules/uniSoc/uniSoc4.common.js
//simpleSourceMap2=/lib/uniSoc/uniSoc4.common.js
'use strict';
/*
* @module uniSoc
* @author plundell
* @license Apache2
* @description Unified API for various socket transports with question/answer protocol
* 
* This class can be required in NodeJS by uniSoc.node.js or uniSoc.web.js, or it can be loaded 
* directly in the browser. If required it will export a function which should be called with the
* dependencies, if loaded it expects the dependencies to be set on the global object prior to loading
*
* It provides the common bits of the uniSoc package used by both flavors (nodejs and browser)
*
* @depends BetterEvents
* @depends BetterLog
* @depends BetterUtil.common
*
* @exports function({dependencies}) 	It exports a function which should be run with it's dependencies,
*										which in turn returns the uniSoc_common constructor function
*/
;'use strict';



module.exports=function export_uniSoc_common(dep={}){

	function missingDependency(which){console.warn('Dependencies:',dep);throw new Error("Missing dependency for uniSoc: "+which);}
	const bu=dep.BetterUtil 				|| missingDependency('BetterUtil');
	const BetterLog = dep.BetterLog         || missingDependency('BetterLog');
	const BetterEvents = dep.BetterEvents   || missingDependency('BetterEvents');


	uniSoc.defaultOptions={
		eom:'__EOM__' 			//A string that signifies the end of a message
		,transmitErrors:'all' 	//Should errors be transmitted? This affects the default .onerror callback. Accepted values are
								//  true|'all' => all errors passed unchanged, 
								//  'toString' => transmit error.toString()
								//  'ifPrimitive' => transmit if error is a primitive value, else replace with 'Internal Error'
								//  false|'none' => change all errors to single string: 'error'
								//  'code' => only transmit the error code, defaulting to: 'error'
								//  function => will be set on this.onerror
	}


/*2020-03-18: Instead of having this class rely in any way on the smart class, we've added 3 "middleware" oppertunities 
			  to Client() (beforetransmit, aftertransmit, onresponse) which can be used by the smart class to do it's thing...
			  So now you'll have to setup each client to automatically send and receive smarties... */
	//Optionally you can pass in "smart" to enable builtin support for sending and receiving smart objects
	//that keep each other updated
	// if(dep.smart && typeof dep.smart=='object'){
	// 	if(!dep.smart.uniSoc||typeof dep.smart.uniSoc!='object'||typeof dep.smart.uniSoc.receive!='function'){
	// 		bu._log.warn("Bad optional dependency 'smart'. Expected object with structure: {uniSoc:{receive()}}")
	// 	}else{
	// 		bu._log.debug("uniSoc: Smart objects in responses will be initiated automatically")
	// 		uniSoc.receiveSmarty=dep.smart.uniSoc.receive;
	// 	}
	// }else{
	// 	bu._log.note("uniSoc: Not supporting automatic initiation of smart objects");
	// }




	/*
	* @constructor 	uniSoc	Parent class for all uniSoc classes
	*
	* @param object 		options
	*
	* @extends BetterEvents
	*
	*
	*
	* @prop number 	id 				Unique id integer, between 0-10,000,000
	* @prop <BetterLog> log
	* @prop object sentRequests
	* @prop object endpoints
	* @prop string EOM
	*
	* @prop function 	handler Can be changed at any time. Will be called with each new message
	*								 with args:
	*									subject - string
	*									data - any
	*									callback(err,response) - function
	*
	* @method send
	* @method request
	* ...
	*
	* @emit _working 	Emitted when this.receivedRequests becomes non-empty
	* @emit _waiting 	Emitted when this.receivedRequests becomes empty
	*
	* All uniSoc instances should implement
	*
	* @prop boolean connected 	Sending is ok
	*
	* @emit _connect 		Sending is now ok
	* @emit _disconnect 	Sending is not ok any more
	*
	*/
	function uniSoc(options){

		if(typeof options=='string'){
			options={name:options}
		}else if(typeof options!='object' || options.constructor.name!='Object'){
			options={};
		}
		options=Object.assign({},uniSoc.defaultOptions,this.constructor.defaultOptions,options);


		//For easy identification of a uniSoc (instanceof will fail if this constructor is loaded
		//multiple times, and you may not want to have to load uniSoc at all) 
		Object.defineProperty(this,'isUniSoc',{value:true});

		/*
		* @prop number id 	A unique id for this instance
		*/
		Object.defineProperty(this,'id',{enumerable:true,value:options.id || Math.floor(Math.random()*10000000)})
		

		if(!options.name)
			options.name=this.constructor.name+'_'+this.id;

		/*
		* @prop object options 
		*/
		Object.defineProperty(this,'options',{enumerable:true,value:options})

		/*
		* @prop <BetterLog> log 
		*/
		Object.defineProperty(this,'log',{value:new BetterLog(this,options)})
		
		//Inherit from BetterEvents and set failed emits to log to our log
		BetterEvents.call(this,{onerror:this.log.error});


		/*
		* @prop object endpoints 		Keys are string endpoint names (used when calling the endpoint over the 
		*								socket, values are objects like: {args, description, listener, visible}.
		*/
		Object.defineProperty(this,'endpoints',{enumerable:true,value:{}})


		/*
		* @prop array sharedEndpoints	Contains objects like this.endpoints or other uniSoc instances
		*/
		Object.defineProperty(this,'sharedEndpoints',{enumerable:true,value:[]})


		/*
		* @prop function onerror 	Will be .call(this,payload) if we're about to transmit an error. Called after 
		*							payload.data and payload.error have been awaited, but before this.beforetransmit
		*/
		if(typeof this.options.transmitErrors=='function'){
			this.onerror=this.options.transmitErrors;
		}else{
			switch(String(this.options.transmitErrors).toLowerCase()){
				case 'tostring':
				case 'string':
					this.onerror=function errorToString(payload){payload.error=error.toString()};
					break;

				case 'onlyprimitive':
				case 'ifprimitive':
					this.onerror=function passPrimitiveError(payload){
						if(bu.isPrimitive(payload.error)){
							payload.error=this.log.makeError(payload.error);
							let msg=`Sending 'Internal Error' as response to request ${payload.id}.`;
							if(payload.error.printed)
								this.log.trace(msg);
							else
								payload.error.addHandling(msg).exec();

							payload.error='Internal Error';
						}
					}
					break;
				case 'none':
				case false:
					this.onerror=function passPrimitiveError(payload){
						payload.error=this.log.makeError(payload.error);
						let msg=`Sending 'error' as response to request ${payload.id}.`;
						if(payload.error.printed)
							this.log.trace(msg);
						else
							payload.error.addHandling(msg).exec();
						payload.error='error';
					}
					break;
				default:
				// case true:
				// case 'all':
					var first=true;
					this.onerror=function transmitErrors(payload){
						//payload.error has already been set to the error, and payload.data==null
						if(first){
							first=false;
							this.log.note("Remember, we are transmitting errors...");
						}
					}
					break;
			}
		}


		/*
		* @prop function|null ontransmit 	Will be .call(this,payload) just before _transmit() is called
		*/
		this.beforetransmit=null

		/*
		* @prop function|null aftertransmit 	Will be .call(this,payload) just after a successful _transmit()
		*/
		this.aftertransmit=null

		/*
		* @prop function|null onresponse 	Will be .call(this,payload) on a successful response, just before passing
		*									it on to the original caller (ie. the one waiting for the response)
		*/
		this.onresponse=null


		//Register a single endpoint allowing opposite side to querey our endpoints
		this.registerEndpoint('help',()=>Object.entries(this.listVisibleEndpoints())
			.map(([name,{args,description}])=>`${name}(${args})${description ? ' '+description:''}`).join('\n')
		);
		
	}
	uniSoc.prototype=Object.create(BetterEvents.prototype); 
	Object.defineProperty(uniSoc.prototype, 'constructor', {value: uniSoc}); 


	/*
	* Close a socket/shutdown a server... ie. terminate whatever connection we're talking about
	*
	* NOTE: This method calls ._kill() which should be defined on all child classes
	*
	* @emit _disconnect 	Either from here, or from the respective _kill()
	*
	* @return Promise(void|BUGBUG) 	Should resolve when shutdown is complete
	*/
	uniSoc.prototype.close=
	uniSoc.prototype.disconnect=
	uniSoc.prototype.shutdown=
	uniSoc.prototype.terminate=
	uniSoc.prototype.kill=function(err){
		if(!(this instanceof uniSoc)){
			BetterLog._syslog.reject("BUGBUG: disconnect() called in non-instance scope, cannot disconnect. this:",this);
		}else{
			if(!this.connected){
				if(!this.alreadyEmitted('_connect')){
					this.log.info("Not yet connected, so won't emit _disconnect...");

				}else if(!this.alreadyEmitted('_disconnect')){
					this.log.warn("Possible EDGE CASE. .kill() was called, we're not connected, but _disconnect has not been emitted. Doing so now...")
					this.emit('_disconnect',err);
				}
				return Promise.resolve();
			} else if(typeof this._kill=='function') {
				this.log.trace("Going to close socket...")

				//2019-11-05: I think we should let each class listen for it's own events and set this
				// try{this.connected=false;}catch(err){} //we might have a getter in place, in which case that takes presidence
				
				return Promise.resolve(this._kill())
					.catch(this.log.error) //errors from the _kill function, not the error passed in here^
					.then(()=>{this.emitOnce('_disconnect',err);}); //Only emit once
			}else{
				return this.log.reject("BUGBUG: no disconnect function set");
			}
		}
	}



	/*
	* Parse args passed to send(...args) or request(...args)
	*
	* @param array[subject, data..., callback] 		
	*	- OR -
	* @param array[object{subject,data,callback,timeout, expResCount}] 		
	*
	* NOTE: the later ^ can accept more args
	* 
	* @throws <ble EINVAL> 		payload.subject is invalid
	*
	* @return object 	An object with named args
	*/
	uniSoc.prototype.parseArgs=function(args){
		if(args.length==1 && typeof args[0]=='object' && args[0].hasOwnProperty('subject'))
			//This object can contain more params then vv
			var obj=args[0];
		else
			obj={
				callback:bu.getFirstOfType(args,'function',true)
				,subject:args.shift() //first non-function is the subject
				,data:(args.length==1 ? args[0] : !args.length ? undefined : args) //everything else is the data
			}

		//Make sure we have a string subject that does not contain the word 'undefined', because that is 
		//most likely an error when dynamically creating the subject
		if(typeof obj.subject!='string')
			this.log.makeError('A string subject is required, got:',bu.logVar(obj.subject)).throw('EINVAL');
		if(obj.subject.includes('undefined'))
			this.log.makeError('Illegal subject contained the string "undefined": '+obj.subject).throw('EINVAL');

		return obj;
	}



	/*
	* Call an endpoint manually from another outside (good if we want to access endpoints locally)
	*
	* @param @see parseArgs()
	*
	* @throws @see parseArgs()
	*
	* @return Promise(mixed|<ble>) 	If $args contains callback, then this promise will ALWAYS resolve with undefined
	*/
	uniSoc.prototype.callEndpoint=function(...args){
		var obj=this.parseArgs(args);
		return new Promise((resolve,reject)=>{
			try{
				ep=this.getEndpoint(obj.subject);
				if(!ep){
					this.log.throwCode('EFAULT',"Endpoint doesn't exist: "+ep);
				}
				let payload={data:obj.data};
				ep.listener.call(this,payload,resolve); //don't pass possible obj.callback here so we can handle err v the same
			}catch(err){
				reject(err);
			}
		}).then(
			data=>{if(obj.callback){obj.callback(null,data)}else{return data}}
			,err=>{err=this.log.makeError(err); if(obj.callback){obj.callback(err)}else{return err.reject()}}
		)
	}




	/*
	* Register a handler $func that is called if this uniSoc receives a message with $subject. The payload of the 
	* message are passed to $func either based on name (if available, see $options.argNames) or order. 
	*
	* NOTE: $func can get custom access by using the following reserved arg names:
	*		'callback' - the error-first callback that sends the response to the sender
	*		'payload' - the live object that was received and will eventually be returned to sender
	*		'unisoc' - the receiveing unisoc (which may differ from the one the endpoint was registered on)
	*  
	* NOTE: if reserved name 'callback' is NOT used then whatever $func returns will be returned to sender
	* 
	* @param string 	subject
	* @paran function 	func    	A function that will be called with 
	* @param object 	options 	Available: 
	*									argNames(array)
	*									reqArgCount(number)
	*									callAs(object)
	*									secret(boolean)
	*
	* @stores object {args, description, listener, visible} => this.endpoints{}
	*
	* @return string 		$subject, used eg by registerEndpointsForObject()
	*/
	uniSoc.prototype.registerEndpoint=function registerEndpoint(subject,func,options={}){
		try{
			var self=this;
			bu.checkTypes(['string','function','object'],[subject,func,options]);

			//Unlike events, only a single endpoint may be registered
			if(this.hasEndpoint(subject,'localOnly'))
				throw "EEXISTS"


			//Try to get names of args. This will not work if function has been bound is is native in which case it
			//will not be possible to call endpoint with object containing named args
			var argNames=options.argNames || func._argNames
			if(!argNames){
				try{
					argNames=bu.getArgNames.call(this,func,true); //true==show default values (but they will be removed vv)
				}catch(err){
					log.warn(`Endpoint '${subject}' will not support named args.`,err);
					
				}
			}

			var reqArgCount=func._length|| func.length; //number of args without default values						

			//Initiate object that will be stored on this.endpoints and start populating it
			var ep={};
			if(Array.isArray(argNames)){
				//Remove the 'reserved args' from those that will be listable and store them in argNames.rest, retaining
				//indexes so args get passed in the correct order
				argNames=bu.filterSplit(argNames,arg=>arg.match(/(callback|payload|unisoc)/)==null,'retainIndex');
				//Store them WITH '=defaultValue'...
				ep.args=Object.values(argNames).join(', ');

				//...but for the sake of matching passed in args below we want to remove the default values
				reqArgCount=0; //count manually the regular args without default values
				argNames.forEach((arg,i)=>{let arr=arg.split('=');if(!arr[1]){reqArgCount++}; argNames[i]=arr[0];}); //<-- defaults^ removed here
				argNames.rest.forEach((arg,i)=>argNames.rest[i]=arg.split('=')[0]);

			}else{
				ep.args=reqArgCount=options.reqArgCount || func._reqArgCount|| reqArgCount;
				argNames=false;
			}
	

			//Same with optional description
			let d=options.description||func._description
			if(typeof d=='string')
				ep.description=d

			/*
			* Listener method wraps around $func^ and gets called by uniSoc_Client.prototype.receive() or uniSoc.prototype.callEndpoint. 
			* It parses $payload.data (figuring out how it maps to the args expected by $func) and calls $func, then it calls $callback with
			* the resulting value or error.
			*
			* NOTE: This is where the live $payload, $callback and 'unisoc' objects are included in the call to $func
			*
			* @param object payload 			The entire received 'payload'. This method mainly concerns itself with payload.data (see body vv
			*                                      for details about handling)
			* @opt function callback 			This is the function bound in/by receive() IF we received a request (as
			*									   opposed to a message that doesn't want a response)
			*
			* @return void
			* @call(receiving unisoc)
			*/
			ep.listener=function endpointListener(payload,callback){
				// self.log.traceFunc(arguments);
				try{
					var argsArr
						,p
						,ignoreReturn=false
						,entry=this.log.makeEntry('info',`${payload.id}: Calling endpoint: ${subject}`);
					;
					switch(bu.varType(payload.data)){
						case 'array':
						//Assumed to be an array of arguments passed to $func in that same order
						// NOTE: this array should NOT consider the 'reserved' args, ie. if func(name, callback, age) then pass [name, age]
						// NOTE2: if you need to pass an array as the single expected arg, then wrap it in another array
							argsArr=payload.data;
							break;
						case 'object':
						//Assumed to be an object of named 
						// NOTE: if you need to pass an object as the single expected arg, then wrap it in an array
							if(!argNames)
								this.log.makeError("This endpoint doesn't support named args. Try consulting docs...").throw('EMISMATCH');

							argsArr=argNames.map(name=>payload.data[name])
							break;
						case 'string':
						case 'number':
						case 'boolean':
						case 'null':
						//Assumed to be the first and only argument passed to $func
							argsArr=[payload.data];
							break;
						case 'undefined':
							argsArr=[];
							break;
						default:
							this.log.makeError("BUGBUG: unexpected payload.data: ",bu.logVar(payload.data)).throw('EINVAL');
					}
					
					//Now make sure we have enough non-reserved args
					if(argsArr.length<reqArgCount)
						this.log.makeError(`Command requires ${reqArgCount} args minimum, only got ${argsArr.length}.`)
							.throw('EINVAL');

					//If any reserved args where requested, set them on the argsArr where appropriate (overwriting
					//anything possibly set ^)
					if(argNames && argNames.rest.length){
						argNames.rest.forEach((name,i)=>{
							switch(name){
								case 'callback':
									if(typeof callback=='function'){
										ignoreReturn=true;
										entry.addHandling("Including response callback. If it's not called, then no response will be sent");
									}else{
										entry.lvl=5;
										entry.addHandling("option.callback being ignored because no response requested");
									}
									argsArr[i]=callback;
									return;

								case 'payload':
									entry.addHandling("Including live payload. You can set additional props on it before sending")
									argsArr[i]=payload;
									return;

								case 'unisoc':
									entry.addHandling("Including receiving uniSoc");
									argsArr[i]=this;
									break;
							}
						})
					}


					entry.extra.push('( '+(argsArr.length ? argsArr.map(x=>bu.logVar(x,50)).join(', ') : '<void>')+' )' )
					entry.exec();
					this.log.trace("About to call endpoint func with:",argsArr);
					p=bu.applyPromise(func,argsArr,options.callAs)

				}catch(err){
					err=this.log.makeError(err);
					if(err.code=='EINVAL'){
						err.exec(); //print here...
						p=Promise.reject(err.toString()); //...but also send msg over socket as string
					}else{
						p=err.reject(); //these will get caught in preparePayload(), logged there, and InternalError sent over socket
					}
				}

				var who=(payload.id?payload.id+': ':''),log=this.log
				if(typeof callback=='function'){ //this is the callback created in receive()
					//RESPONSE EXPECTED
					if(argNames && argNames.rest.includes('callback')){
						//If you've asked for the callback then it's up to you to call it if you want something sent, error or success
						//Uncaught errors get logged vv
					}else{
						p=p.then(
							function respondingWithData(data){callback(null,data)}
							,function respondingWithError(err){callback(err)}
						)
					}
					p.catch(function responseCallbackError(e){log.error(`${who}Failed to return request reponse`,e)});
				}else{
					//NO RESPONSE
					p.then(
						function respondingWithData(data){
							(typeof data!='undefined')
								&&log.note(`${who}Endpoint returned data but none was expected:`,data)
						}
						,function endpointFunctionError(err){log.error(`${who}Endpoint call failed.`,err)}
					);
				}

				return;
			}

			//Now we're going to add the listener to the endpoint event, but first the option to make it 
			//"secret", ie. so it doesn't show up with 'help'. Obviously this just makes it secret
			//for anyone who doesn't have access to this object, like the other side of the socket
			ep.visible=options.secret?false:true;
			this.endpoints[subject]=ep
			this.log.debug(`Added ${options.secret ? 'secret ':''}endpoint: ${subject}(${ep.args})`);

			return subject;
			
		}catch(err){
			// console.log(this);
			throw this.log.error("Failed to register method:",subject,err);
		}
	}






	/*
	* Get an endpoint from those registered locally and those extendedn from other sources
	*
	* @param string subject
	* @opt boolean localOnly 	Default false. If true only locally registered endpoints will be returned
	*
	* @throw TypeError 	If $subject isn't a string
	*
	* @return object{listener,args,description}|undefined
	*/
	uniSoc.prototype.getEndpoint=function(subject,localOnly=false){
		// this.log.traceFunc(arguments);
		bu.checkType('string',subject)

		try{
			var ep,source;
			if(this.endpoints.hasOwnProperty(subject)){
				source='local';
				ep=this.endpoints[subject];
			}else if(!localOnly){
				for(var i in this.sharedEndpoints){
					let obj=this.sharedEndpoints[i];
					if(typeof obj.getEndpoint=='function'){
						source='shared'+(obj.isUniSoc?' (from '+obj.options.name:'(function')+')';
						ep=obj.getEndpoint(subject); //Remember, the other unisoc will traverse down it's tree of shared endpoints
					}else if(obj.hasOwnProperty(subject)){
						source='shared'
						ep=obj[subject];
					}
					if(ep)
						break;
				}
			}

			if(ep){
				//Just in case something went wrong or someone has been messing
				//with the endpoints manually...
				if(typeof ep!='object' || typeof ep.listener!='function'){
					this.log.error(`Unexpected ${source} endpoint '${subject}'. Got:`,bu.logVar(ep));
					return undefined;
				}
			}
			// this.log.trace('Returning:',ep);
			return ep; //can be undefined
		}catch(err){
			this.log.error(`BUGBUG: Failed to get endpoint '${subject}'`,err,{ep,source});
			return undefined;
		}
	}





	/*
	* Get all visible endpoints for this object. Used to display help
	* @return object 	Keys are endpoint subjects, values are objects with 
	*/
	uniSoc.prototype.listVisibleEndpoints=function(){
		//First get local visible endpoints...
		var endpoints=bu.subObj(this.endpoints,(subject,obj)=>obj.visible);

		//Then look through our shared endpoints
		this.sharedEndpoints.forEach(x=>{
			var subject, shared = (typeof x.listVisibleEndpoints=='function' ? x.listVisibleEndpoints() : x);
			for(subject in shared){
				if(shared[subject].visible && !endpoints.hasOwnProperty(subject))
					endpoints[subject]=shared[subject];
			}
			
		})
		return endpoints;
	}


	/*
	* Check if and endpoint or secret endpoint exists
	*
	* @param string subject
	*
	* @return boolean
	*/
	uniSoc.prototype.hasEndpoint=function(subject,localOnly){
		return this.getEndpoint(subject,localOnly) ? true : false;
	}




	/*
	* Remove an endpoint or secret endpoint
	*
	* @param string endpoint
	*
	* @return void
	*/
	uniSoc.prototype.unregisterEndpoint=function(subject){
		delete this.endpoints[subject]
		return;
	}




	/*
	* Add shared endpoints to this uniSoc
	*
	* @param <uniSoc>|object endpoints 	A regular object containing multiple named endpoint objects (eg. this.endoints) 
	*									or another uniSoc instance
	* @return void
	*/
	uniSoc.prototype.registerSharedEndpoints=function(endpoints){
		bu.checkType('object',endpoints);

		if(typeof endpoints.getEndpoint=='function'&&typeof endpoints.listVisibleEndpoints=='function'){
			if(!this.sharedEndpoints.includes(endpoints))
				this.sharedEndpoints.push(endpoints);
		}else{
			//If we get a regular object, then only the endpoints that exist now are added
			var clean={},ep;
			for(ep in endpoints){
				if(endpoints[ep].hasOwnProperty('listener')){
					clean[ep]=bu.extract(endpoints[ep],['listener','description','args','visible']);
				}
			}
			this.sharedEndpoints.push(clean);
		}
		return;
	}

























	/*
	* Register endpoints for all enumerable methods and props on an object
	*
	* @param object obj 	  			Any object
	* @param string prefix 	  			A string to use as first part of endpoint (will be surrounded by '/')
	* @param object options 			Options for this method + for registerEndpoint(). 
	*    @option object  _all.{...} 			  Will be passed to registerEndpoint() each time
	*    @option object  [name of prop on $obj]	  Will be passed to registerEndpoint(obj.prop,...)
	*    @option array   ignore 				  List of props on $obj to ignore
	*    @option bool    getProps                 All props are turned into get-only endpoints without '/get' suffix
	*
	* @throws <BLE_TypeError>
	*
	* @return array [string]  List of all the registered endpoints		
	*/
	uniSoc.prototype.registerEndpointsForObject=function(obj,prefix,options={}){
		bu.checkTypes(['object','string','object'],[obj,prefix,options]);

		//Decide which props to register and which to ignore
		var ignore=[], props=Object.keys(obj);
		if(Array.isArray(options.ignore)){
			props=props.filter(key=>{
				if(options.ignore.indexOf(key)>-1){
					ignore.push(key)
					return false
				}
				return true;
			});
		}

		
		if(!props.length){
			this.log.warn("No props are going to be registered from: ",obj);
			return [];
		}
		this.log.debug("Registering props as endpoints: "+props.join(',')
			+(ignore.length?'. Ignoring these: '+ignore.join(','):''))

		var list=[];
		props.forEach(prop=>{
			//Build options
			var opts=Object.assign({callAs:obj},options._all,options[prop]);

			var ep=`/${prefix}/${prop}`;
			if(typeof obj[prop]=='function'){
				list.push(this.registerEndpoint(ep,obj[prop],opts))

			}else if(options.getProps){
				//Props can only be fetched, not set... and not '.../get' suffix is used
				list.push(this.registerEndpoint(ep,function get(){return obj[prop];},opts));

			}else{
				var desc=Object.getOwnPropertyDescriptor(obj,prop);
				if(desc.hasOwnProperty('value')){
					//Just a value, no getter and setter present...
					list.push(this.registerEndpoint(`${ep}/get`,function get(){return obj[prop];},opts));
					if(desc.writable){
						list.push(this.registerEndpoint(`${ep}/set`,function set(val){return obj[prop]=val;},opts));
					}
				}else{
					//This implies there are getters and setters already in place...
					if(desc.get){
						list.push(this.registerEndpoint(`${ep}/get`,desc.get,opts));
					}
					if(desc.set){
						list.push(this.registerEndpoint(`${ep}/set`,desc.get,opts));
					}
				}
			}
		})
		return list;
	}


	/*
	* Reverse registerEndpointsForObject() to produce an object with methods/setter/getter. 
	*
	* @param array[string] endpoints 	
	*
	* @return object 
	*/
	uniSoc.prototype.createProxyFromEndpoints=function(endpoints){
		bu.checkType('array',endpoints);
		var proxy={};
		endpoints.forEach(ep=>{
			try{
				//We expect ep to be a '/' delimited string with a prefix followed by either method name or 
				//prop+get/set, eg. 						--prefix-- 			--method/prop--   --get/set--
				//		/prefix1/method1 			=>   ['','prefix1',				'method1']
				//		/prefix1/method2 			
				//		/multipre/fix2/method1		=>   ['','multipre','fix2',		'method1']
				//		/multipre/fix2/prop1/get
				//		/multipre/fix2/prop2/get 	=>   ['','multipre','fix2',		'prop2',		'get']
				//		/multipre/fix2/prop2/set
				//
				// Which we will set on the above created proxy object like so:
				// 	{
				// 		"/prefix1:{
				//	 		method1:function()
				//	 		,method2:function()
				//	 	}
				//	 	"/multipre/fix2":{
				//	 		method1:function()
				//			,prop1:getter()
				//			,prop2:getter(),setter()
				//	 	}
				//	 }
				var arr=ep.split('/');

				//Since we always use prefix when creating endpoints from objects, so the non-existence of one 
				//means this ep has slipped in here by mistake
				if(arr.length<2)
					return;

				var prop=arr.pop(),gs=false;
				if(prop=='set' || prop=='get'){
					gs=prop;
					prop=arr.pop();
				}

				if(!prop){
					this.log.warn("Unexpected endpoint, skipping:",ep);
					return;
				}

				let prefix=arr.join('/'); 
				if(!proxy.hasOwnProperty(prefix))
					proxy[prefix]={}

				if(gs=='set')
					//configurable since get/set are seperate endpoints and as such the property may need updating
					Object.defineProperty(proxy[prefix],prop,{enumerable:true,configurable:true,set:(val)=>this.request(ep,val)})
				else if(gs=='get')
					Object.defineProperty(proxy[prefix],prop,{enumerable:true,configurable:true,get:()=>this.request(ep)})
				else{
					Object.defineProperty(proxy[prefix],prop,{enumerable:true
						,value:(...args)=>this.request(ep,args.length ? args:undefined)});
				}
			}catch(err){
				this.log.error(`Failed to add endpoint ${ep}' to proxy obj.`,err);
			}
		})

		return proxy;
	}










	uniSoc.prototype.getRemoteEndpoints=function(){
		return this.request('help');
	}





































	/*
	* Common constructor for all uniSoc items that are clients (ie. only uniSoc_Server does NOT
	* inherit from this)
	*/
	function uniSoc_Client(options){
		uniSoc.call(this,options);

		/*
		* @prop object 	sentRequests 	Keys are numerical id's requests we've sent, values are 
		*								callback functions for when responses arrive. 
		*
		* NOTE: Children will be deleted when responses arrive and moved to this.history.sent
		*/
		Object.defineProperty(this,'sentRequests',{enumerable:true,value:{}})	


		/*
		* @method sentRequests.length 	The number of requests we're waiting for answers on
		*/
		Object.defineProperty(this.sentRequests,'length',{get:()=>Object.keys(this.sentRequests).length});

		/*
		* @prop object receivedRequests	Keys are numerical id's of requests we've received and are 
		*								currently working on a response for, values are callback 
		*								functions that will answer them.
		*
		* NOTE: Props will be deleted when responses are sent  and moved to this.history.sent
		*/
		Object.defineProperty(this,'receivedRequests',{enumerable:true,value:{}})	

		/*
		* @method receivedRequests.length 	The number of requests we're currently working on and are 
		*									ultimately going to respond to
		*/
		Object.defineProperty(this.receivedRequests,'length',{get:()=>Object.keys(this.receivedRequests).length});


		Object.defineProperty(this,'history',{enumerable:true,value:{}})	
		Object.defineProperties(this.history,{
			sent:{enumerable:true,value:[]}
			,received:{enumerable:true,value:[]}
		})
		

		//Set the default EOM which should usually work... but maybe for some reason we need to change it
		//to work with some external client or something...
		Object.defineProperty(this,'EOM',{writable:true,enumerable:false, value:options.eom})
	}
	uniSoc_Client.prototype=Object.create(uniSoc.prototype); 
	Object.defineProperty(uniSoc_Client.prototype, 'constructor', {value: uniSoc_Client}); 










	/*
	* Each _transmit() function should call this method
	*
	* @return true|Promise.reject(<BetterLogEntry [not logged]>) 	
	*/
	uniSoc_Client.prototype.afterTransmit=function(err,payload,address,port){

		var fail='Failed to transmit';
		if(err && err.toString().match(fail)) //so we don't double up
			return this.log.makeEntry(err).reject();

		var id='',what=(payload.subject=='__uniSoc_response'?'response':'message')
		if(payload.id){
			if(this.sentRequests[payload.id]){
				what='request'
			}
			id=payload.id+': ';
		}

		if(address||port)
			what+=` to ${address||''}:${port||''}`
		if(err)
			return this.log.makeError(`${fail} ${what}:`,err).reject();
		else{
			this.log.info(`${id}Successfully sent ${what}:`
				,'subject: '+(payload.target||payload.subject)+'\n' //\n=>all extra on own line
				,'error: '+bu.logVar(payload.error)
				,'data: '+bu.logVar(payload.data)
			)
			
			//In case we want to apply futher handling to all successfully transmitted messages, here's the chance
			if(typeof this.aftertransmit=='function'){
				this.aftertransmit.call(this,payload);
			}


			return true;
		}
	}



	/*
	* Send a new message without expecting a response
	*
	* @params @see parseArgs()
	*
	* @return Promise 				Resolves/rejects if sending succeeded
	*/
	uniSoc_Client.prototype.send=function send(...args){
		var {_transmit,...payload}=this.parseArgs(args); 
		
		if(!this.connected){
			this.disconnect('EPIPE'); //Make sure the client gets removed from the server
			return this.log.makeError('Socket is not open, failed to send...').setCode('EPIPE').reject();
		}

		return preparePayload.call(this,payload)
			.then(payload=> _transmit?_transmit(payload):this._transmit(payload)) //the _transmit() method should log
		;
	}

	/*
	* Send a new message that expects a response
	*
	* @params @see parseArgs()
	* 	@opt function callback 	Called with response error or success. Not called if sending fails. Affects what
	*							this method returns.
	*
	* @return Promise 		Always rejects if sending fails. Resolve depends on $callback:
	*							If passed: it resolves when sending succeedes with id (used to unregister request). 
	*							If omitted: resolves/rejects with the response from the other side of the socket.
	*/
	uniSoc_Client.prototype.request=function request(...args){
		var {callback,timeout,_transmit,...payload}=this.parseArgs(args);
		
		if(!this.connected){
			this.disconnect('EPIPE'); //Make sure the client gets removed from the server
			return this.log.makeError('Socket is not open, failed to send...').setCode('EPIPE').reject();
		}
		
		var [id,promise,onSendSuccess,onSendError]=prepareRequest.call(this,callback,timeout);
		payload.id=id; //this id is was identfies the msg as a request() and not a send()


		//The following chain will always resolve (so no need to do anything with it)...
		preparePayload.call(this,payload)
			.then(payload=>_transmit?_transmit(payload):this._transmit(payload))
			.then(success=>{this.history.sent.push(id); return success;})
			.then(onSendSuccess,onSendError)

		//...but it will affect the returned promise
		return promise;
	}







	/*
	* Prepare a payload to be sent via uniSoc, mainly by waiting for promises to resolve and making
	* sure no Error objects get transfered
	*
	* @param object payload 	Object which contains props (all but the first are optional):
	*								string subject 			
	*								any data 				Any data to be transfered
	*								string|number error 	Instances of Error will be replaced by string 'Internal Error
	*								number id 				If omitted, 0 will be used, which indicates that no response
	*														  is expected 
	* @reject <ble TypeError> 	payload is not object
	*
	* @resolve obj 		Resolves with the payload ready to be sent (ie. all promises resolved and preparation callbacks made)
	*
	* @call(<uniSoc_Client>)
	* @async
	*/
	async function preparePayload(payload){
		try{

			//Then we start checking we got the right things
			bu.checkType('object',payload);


			//Mark the object as uniSoc, so we can identify it in certain cases where other things
			//may be transmitted on the same socket
			payload.__uniSoc=true;

			//Make sure we have an id, >0 if this is the response to a request, else 0 which implies
			//that we're sending something and not expecting a response
			payload.id=typeof payload.id=='number' ? payload.id : 0


			//Await the data and error, and if anything goes wrong it's the same as if an error was passed
			try{
				payload.error=await payload.error; 
				payload.data=await payload.data;
			}catch(error){
				payload.error=error;
			}


			//If we have an error now (passed or caught ^, it's all the same)...
			if(payload.error){
				//...we make sure there's not data as well...
				if(payload.data){
					let msg="Got data and error. Sending the error and discarding"
					if(bu.varType(payload.data)=='promise'){
						//Don't wait for data to resolve... just log now and then again on resolve
						let ble=this.log.makeEntry('warn',msg+" promised data (see later log)").exec();
						payload.data
							.then(data=>this.log.warn(`Discarded data from entry #${ble.id}:`,data))
							.catch(err=>this.log.warn(`Discarded promise from entry #${ble.id} rejected:`,err))
					}else{
						this.log.warn(msg+" this data:",payload.data);
					}
					payload.data=null;
				}

				//...and we call the handler, set either in the constructor or at any later point. It can do whatever
				//it wants with the payload...
				this.onerror(payload);
			}

			//F.Y.I what get's included when sending...
			//  JSON.stringify({data:undefined}) => '{}'  		
			//  JSON.stringify({data:null}) => '{"data":null}' 

			//In case we want to apply futher handling to all payloads, here's the chance
			if(typeof this.beforetransmit=='function'){
				this.beforetransmit.call(this,payload);
			}

			this.log.makeEntry('debug','Payload ready:',payload).addHandling("next step is transmitting...").exec();


			return payload;								
			  //^ remember, async func, this will be returned in a resolved promise
		}catch(err){
			return this.log.makeError('Failed to prepare payload',err).reject()
		}

	}



	/*
	* Prepare a callback for a request
	*
	* @opt @anyorder function responseCallback 	Called with each (ie. possibly multiple) resopnses with args (err,data,obj).
	* @opt @anyorder number timeout  			ms until request failes with 'timeout' error. Default 0 == infinite

	* NOTE: If @responseCallback isn't passed, only a single response is accepted, else responses will keep being accepted
	*		 until you call this.cancelRequest() with the id (see @return vv) or @responseCallback itself 
	* NOTE2:The 3rd arg passed to @responseCallback is the entire received uniSoc-formated object. It IS NOT available
	*		 in the resolved promise if you omit @resopnseCallback
	*
	* @return array [ 			Returns an array with the 4 following items:
	*		number 					The id of the request (passed on to preparePayload() by request())
	*		,Promise 				The promise to be returned by request(). Rejects if sending fails. If $responseCallback is
	*								  passed it resolves when sending succeedes with id (used to unregister request). Else  it 
	*								  resolves/rejects with the response from the other side of the socket.
	*		,callback(err) 			Callback to be used on send error
	*		,callback 				Callback to be used on send success (only if @responseCallback was passed in)
	*	] 	
	*
	* @call(<uniSoc_Client>)
	*/
	function prepareRequest(responseCallback=undefined,timeout=0){

		// Start by generating an id used to identify the response when it comes
		var id=Math.floor(Math.random()*1000000000)+1; //+1 we we don't get 0 
		// console.log(this);
		while(typeof this.sentRequests[id]!=='undefined'){
			id+=1;
		}
		var logStr=`Built request (${id}), response via `;


	    //For logging purposes in web, we want to avoid anon functions....
	    var self=this;
		
		if(typeof responseCallback=='function'){
			logStr+='callback'
			var {resolve:onSendSuccess,reject:onSendError,promise:sendPromise}=bu.exposedPromise();
			
			//Logging has already been done by send, just change what's returned on success and make
			//sure to unregister on failed send
			sendPromise=sendPromise.then(
				()=>id
				,function failedToSendRequest(err){
					self.cancelRequest(id);
					return Promise.reject(err);
				}
			);

			//Unlike vv where a timeout will fail an outstanding request, here it merely
			//unregisters the request as a means of convenience
			if(timeout){
				logStr+=`, active for ${timeout} ms`			
				setTimeout(()=>{
					if(this.sentRequests[id]){
						this.log.debug(`Request ${id} timed out after ${timeout} ms.`);
						this.cancelRequest(id);
					}
				},timeout)
			}

		} else {
			logStr+='promise'
			var {reject:requestFailed,promise:responsePromise,callback:responseCallback}=bu.exposedPromise();
			//Since we don't want responsePromise to be resolved, we don't use the method returned by 
			//exposedPromise() and instead create one here... that we also use to log
			var sent=false
			var onSendSuccess=()=>{sent=true;}; 

			responsePromise=bu.promiseAlways(responsePromise,()=>{
				//Since @responseCallback wasn't passed in, we will only listen for the first response,so whatever
				//that response is (or if there is a problem with sending), unregister the request
				this.cancelRequest(id);
			});

			//In case we've already sent, add a note so it's clear where the error comes from
			responsePromise=responsePromise.catch(function requestFailed(err){
				if(sent)
					return self.log.makeError(err)
						.addHandling(`This is an error-response to request ${id}`).reject();
				else
					return Promise.reject(err);
			})

		

			//A timeout here (unlike with callback^) will fail an outstanding request
			if(timeout>0){
				logStr+=`, timeout in ${timeout} ms`
				setTimeout(()=>{
					if(this.sentRequests[id]){
						var err=this.log.makeError(`Request (${id}) timed out after ${timeout} ms.`).setCode('timeout');
						requestFailed(err);
					}
				},timeout)
			}
		}


		this.log.makeEntry('trace',logStr).addHandling("next step is preparing payload...").exec();
		this.sentRequests[id]=responseCallback;
		return [id,sendPromise||responsePromise,onSendSuccess,onSendError||requestFailed];
	}



	/*
	* @no_throw
	* @return boolean 	True if a request was canceled, else false
	*/
	uniSoc_Client.prototype.cancelRequest=function cancelRequest(idOrCallback){
		try{
			this.log.traceFunc(arguments,'cancelRequest');

			if(bu.checkType(['number','function'],idOrCallback)=='number'){
				if(this.sentRequests[idOrCallback]){
					delete this.sentRequests[idOrCallback];
					return true;
				}else
					this.log.warn("No pending request with id: ",idOrCallback);
			}else{
				var id=this.sentRequests.indexOf(idOrCallback);
				if(id>-1){
					delete this.sentRequests[id];
					if(this.sentRequests.indexOf(idOrCallback)>-1)
						this.log.note("More than one instance of callback registered, only deleted first.",idOrCallback)
					return true;
				}else
					this.log.warn("No pending request with callback: ",idOrCallback);
			}
		}catch(err){
			this.log.error("Error trying to cancel request",err);
		}
		return false
	}



















	function getFrom(payload){
		var rinfo=Object.assign(bu.subObj(payload,'rinfo')||{},bu.subObj(payload,['ip','hostname','host','address','port'],true));
		var address=rinfo.address||rinfo.host||rinfo.hostname||rinfo.ip||'', port=rinfo.port||''
		if(!address && !port)
			return ''
		else
			return ` from ${address}:${port}`
	}



	/*
	* Handler for responses received for a request (ie. used on original initiator's side to dispatch
	* the response to the caller)
	*/
	function receiveResponse(payload){
		if(typeof this.sentRequests[payload.id]!='function'){
			throw new Error(`Received response to non-existent request ${payload.id}`);
		}

		var msg=`response to ${payload.target}${getFrom(payload)}`
		if(payload.error==null){

			this.log.debug(`${payload.id}: Received successfull ${msg}:`, payload.data);

			//If we've registered a middleware... ProTid: This is eg. where we may initiate a received smarty...
			if(typeof this.onresponse=='function'){
				this.onresponse.call(this,payload);
			}
			
		}else{
			// console.log('FAILED RESPONSE:',payload.error);
			this.log.note(`${payload.id}: Received failed ${msg}:`,this.log.makeError(payload.error).toString());
		}



		//Now call the response callback. 
		var shouldCancel=this.sentRequests[payload.id].call(null,payload.error,payload.data, payload);

		//If it returns 'cancel' then we cancel the request 
		if(shouldCancel==='cancel'){
			this.log.debug("responseCallback returned 'cancel', cancelling request....")
			this.cancelRequest(payload.id);
		}

		return;
	}




	/*
	* Callback used to transmit the response to a request. uniSoc_Client.prototype.receive() wraps and passes this function
	* on to the registered endpoint.
	*
	* @param @bound object request 		The received payload
	* @opt any error 					Should only be passed on error, else leave undefined. Errors may still
	*									  still 
	* @opt any data 					The successfull data to return. If it's a promise and subsequently rejects
	*									  it's future is determined by this.ondatareject
	*
	* @return Promise(boolean,n/a) 	Always resolves after sending has been attempted with success boolean
	*
	* @bind(receiving socket, received payload)
	*/
	async function responseCallback(request,error,data){
		var success=true;
		try{
			this.log.traceFunc(arguments,`${request.id}: `);
			//Use the received object, but replace stuff with the new information we got. This way, 
			//stuff like eg. 'address' and 'port' which dgram includes, gets passed back to send() 
			//function and can be used if needed.
			request.target=request.subject; //for use in logging
			request.subject='__uniSoc_response';

			//If error or data were passed, set them, else let possible values already set on $request stand
			request.error=(arguments.length>1 ? error : request.error)
			request.data=(arguments.length>2 ? data : request.data)

			if(error=='__uniSoc_EALREADY'){
				request.error={code:"EALREADY",msg:"You already have an outstanding request with ID "
					+request.id+", please increment id or wait for response before requesting again"};
			}else{
				//Even if sending fails vv, the request has been handled, so delete it
				delete this.receivedRequests[request.id]
			}

			await this.send(request);
		}catch(err){
			this.log.error(`Failed to respond to request ${request.id}`,err);
			success=false
		}
		//If we want to take any actions when we're no longer _working
		try{
			if(!this.receivedRequests.length)
				this.emit('_waiting');
		}catch(err){
			this.log.error("BUGBUG:",err)
		}

		return success; //Always return resolved promise, since this is a best effort kind of thing
	}



	/*
	* This method gets called with ALL incomming messages and handles them in 1 of 3 ways:
	*   1) a new message => call endpoint/listener
	* 	2) a new request => create response callback => call endpoint/listener
	*	3) the response to a request => receiveResponse() => calls the waiting callback
	*
	* @param object obj

	* @return void
	*/
	uniSoc_Client.prototype.receive=function(payload){
		try{
			bu.checkProps(payload,{subject:'string'}); //sanity check that we passed the right thing
			// console.log('THIS IN receive:',this)
			// if(this.rinfo && payload.rinfo)
			// 	this.log.highlight('red','rinfo in both socket and payload',this.rinfo,payload.rinfo)
			// else if(this.rinfo)
			// 	this.log.highlight('blue','we have rinfo on socket',this.rinfo)
			// else if(payload.rinfo)
			// 	this.log.highlight('blue','we have rinfo on payload',payload.rinfo)
			// else
			// 	this.log.highlight('magenta','no rinfo ANYWHERE');
			

			//Check if this message is a response, or a new message wanting a response, or a new message
			//wanting nothing (like a multicast or the like...)
			payload.id=Number(payload.id)||0
			var id='';
			if(!payload.id){
				this.log.debug("Received message (no response expected):",payload);

			}else{
				this.history.received.push(payload.id);

				if(payload.subject=='__uniSoc_response'){
					receiveResponse.call(this,payload);
					return;

				}else{
					id=payload.id+': ';
					this.log.debug(`${id}Received request:`,payload); 

					//Bind the response callback, and wrap it so it can only be called once!
					var callback=bu.once(
						responseCallback.bind(this,payload)
						,()=>this.log.makeEntry('warn','responseCallback() called multiple times! This time')
							.changeWhere(1).addFrom().exec()
					);

					//For simplicity require incoming messages to have unique id's so that logging and everything
					//matches everywhere. If duplicates arrive the sender will just have to send again. Technically 
					//we don't need the id's for anything beyond logging, so we could skip this rule, but what the hell, 
					//clashes should be so very far inbetween that we may as well not bother...
					if(this.receivedRequests.hasOwnProperty(payload.id)){
						callback("__uniSoc_EALREADY");
						return;

					}else{
						//If we want to take any actions when we're no longer _waiting
						if(!this.receivedRequests.length){
							this.emit('_working');
						}

						//In case we need to cancel the request early b/c eg. a shutdown... The callback is removed
						//from within itself once called...
						this.receivedRequests[payload.id]=callback;
					}
				} 
			}


			//Now either call an endpoint or a listener
			var ep=this.getEndpoint(payload.subject)
			if(ep){
				//Endpoints are 'special' listeners, limited to 1 per subject and registered with custom options via 
				//registerEndpoint()
				ep.listener.call(this,payload,callback); //callback will be undefined if not a request
				
			}else{
				var l=this.countListeners(payload.subject,true)//true=>any listener, even onUnhandled() and onAll()
					,what=`for '${payload.subject}' ${callback?'with':'without'} callback`
				;

				if(l){
					this.log.info((l>0? `${id}Calling ${l} listeners ${what}`:`${id}Calling ${-1*l} onAll/onUnhandled listeners ${what}`))

					//Regulare listeners get called with:
					this.emitEvent(payload.subject,[payload.data,callback,payload.payload]);
				}else{
					this.log.warn(`${id}New ${callback?'request':'message'} on subject '${payload.subject}' received, but no handler registered.`,
						'Payload:',payload);
					if(callback){
						callback('404 Not Found');
					}
				}
			}

			return;

		}catch(err){
			// console.error(err,payload);
			this.log.makeError(err).addHandling('Error while handling incoming message:',payload).exec();
		}
	}







	/*
	* Transmitt all or some events from an emitter over the socket. 
	*
	* NOTE: This is not suitable for streaming data (ie. reading from a file where thousands of 
	*		events are emitted) since there is overhead with each transmitted event
	*
	* @param <BetterEvents>|object emitter 	Must have method .emit(), and that method must be called by name
	*										for the events to be extened. 
	* @param object options 	The following are available:
	*							  exclude - function|array - Extend all but these events
	*							  include - function|array - Ignored if 'exclude' passed. Extend only these events. 
	*							  prefix - string - Send all events individually with subject /prefix/evt
	*							  subject - string - Ignored if 'prefix' passed. Send all events with this subject,
	*													first arg will be evt
	*
	* @throw BLE(TypeError)
	* @return function|undefined 	If $emitter is <BetterEvents> then the listener added to the emitter so
	*								it can be used for removal or exclusion. For any other emitter, undefined.
	*/
	uniSoc_Client.prototype.extendEvents=function(emitter,options={}){
		bu.checkTypes(['object','object'],[emitter,options]);

		if(typeof emitter.on!='function' || typeof emitter.emit !='function'){
			this.log.throwType("emitter object with .on() and .emit()",emitter);
		}
		
		var logStr="Extending"
		
		var {include,exclude,subject,prefix}=options;

		//First we need to know if we're filtering events
		var filter;
		if(exclude){
			exclude=[].concat(exclude)
			logStr+=` all events except '${evts.join("','")}'`
			filter=(evt)=>exclude.indexOf(evt)==-1
		}else if(include){
			include=[].concat(include) //this deals with strings, arrays and undefined
			logStr+=` events '${evts.join("','")}'`
			filter=(evt)=>include.indexOf(evt)>-1
		}else{
			logStr+=` all events`
			filter=()=>true;
		} 

		//Then we need to know if we're interested in the results
		var transmit;
		if(typeof emitter._betterEvents=='object'){
			//FUTURE NOTE: Since BetterEvents uses a loader we can't do instanceof because emitter may have loaded it itself
			logStr+=' (responses ENABLED)'
			transmit=this.request;
		}else{
			logStr+=' (responses DISABLED)'
			transmit=this.send;
		}

	//TODO 2019-12-21: Unregister the listener on _disconnect 
	//TODO 2020-02-14: but then start listening again on reconnect
		//^ 2020-03-02: how would that work? when sockets are dead they're dead, any "reconnect" would be  a new socket

		//And finally if we're going to send all events under one subject, or prefix each event
		var extendEventOverUniSoc;
		if(prefix){
			logStr+=' using prefix '
			extendEventOverUniSoc=((evt,...data)=>{
				// if(evt=='shutdown') console.log('------------------INTERCEPT SHUTDOWN')
				if(!this.connected) return;
				if(!filter(evt)) return;
				return transmit.call(this,{subject:`${prefix}/${evt}`,data});
			}).bind(this);
		}else if(subject){
			logStr+=' using single subject '
			extendEventOverUniSoc=((...data)=>{
				// if(data[0]=='shutdown') console.log('------------------INTERCEPT SHUTDOWN')
				if(!this.connected){return;}
				if(!filter(data[0])){return;}
				return transmit.call(this,{subject,data});
			}).bind(this);
		}else{
			log.throw("Arg #2 must contain either 'prefix' or 'subject' option")
		}
		logStr+=`'${subject}'`;
		this.log.debug(logStr,emitter);
		// console.log('----------------------------------------------------');
		// this.log.highlight('magenta',logStr,emitter);


		//Then we intercept all events on the emitter...
		if(typeof emitter._betterEvents=='object'){
			//FUTURE NOTE: Since BetterEvents uses a loader we can't do instanceof because emitter may have loaded it itself
			//...which is easier if the emitter is of our custom class
			//(use .onAll so events aren't treated as 'handled' just because they're exteneded)
			emitter.onAll(extendEventOverUniSoc);
			this.on('_disconnect',()=>emitter.removeListeners(extendEventOverUniSoc))
			return extendEventOverUniSoc;
		}else{
			this.log.note("Intercepting all calls to .emit() on:",emitter)
			//...else we'll have to intercept by replacing the real emit function. 
			var original=emitter.emit;
			// FUTURE NOTE: Important we don't do emitter._emit=emitter.emit since extendEvents may be called
			//				multiple times => the second time emitter._emit==interceptEmit 
			function newEmit(...args){
				extendEventOverUniSoc.apply(null,args);
				return original.apply(emitter,args);
			}
			//Make sure we don't change the enumerable properties of the object
			Object.defineProperty(emitter,'emit',{value:newEmit,writable:true,configurable:true
				,enumerable:emitter.propertyIsEnumerable('emit')})

			this.on('_disconnect',()=>{
				if(emitter.emit==newEmit){
					delete emitter.emit
				}
			});

			return;
		}

	}














































	/*
	* Common constructor for websockets from both npm's ws module and browsers Websocket API.
	*/
	function uniSoc_Websocket(options){
		//Call the uniSoc constructor as 'this', which sets a few things on this incl log
		uniSoc_Client.call(this,options);
		
		Object.defineProperty(this,'connected',{enumerable:true
			, get:()=>this.socket && this.socket.readyState==this.socket.OPEN})

		//Derived from:
		//  https://www.rfc-editor.org/rfc/rfc6455.txt  (ctrl+f for an error code)
		//  https://github.com/Luka967/websocket-close-codes
		// 	https://docs.microsoft.com/en-us/dotnet/api/system.net.websockets.websocketclosestatus?view=netframework-4.8
		this.log.codes={
			//These two are not errors, they just indicate normal behavior
			1000:"Socket closed normally (this is the expected behavior)."
			,1001:"The socket is closing (eg. client is closing browser tab)."
			
			//Reserved codes which MUST NOT be used manually
			,1005:"Status code missing (ie. received a closing frame without status code)."
			,1006:"Connection closed unexpectedly (ie. no closing frame received at all)"

			,1002:"Protocol error (ie. received a frame that doesn't adhere to Websocket standard)."
			,1007:"Inconsistent data type (e.g. non-UTF-8 data within a text message)."
			
			,1003:"Policy violation: Unsupported data type (e.g. endpoint only understands text data, but received binary)."
			,1009:"Policy violation: Too much data (ie. message is too big to handle.)." //relates to option 'maxPayload'
			,1008:"Policy violation: Generic"

			
			,1010:"Server doesn't support extension demanded by client"
			,1011:"Internal server error"
			,1012:"Server is restarting"
			,1013:"Server is temporarily unable to fullfil client's request, try again later."
			,1014:"Bad gateway (gateway received an invalid response)"
			,1015:"TLS handshake fail"
		}
	}
	uniSoc_Websocket.prototype=Object.create(uniSoc_Client.prototype); 
	Object.defineProperty(uniSoc_Websocket.prototype, 'constructor', {value: uniSoc_Websocket}); 




	/*
	* Setup event listeners on websocket
	*
	* NOTE: This method should be called AFTER this.socket has been set, but does not need to 
	*		wait for connect to have happened
	*
	* @return this
	*/
	uniSoc_Websocket.prototype.registerAllListeners=function(){
		if(!this.socket){
			this.log.makeError("You cannot register listeners before having created/set this.socket")
				.setCode('ESEQ').exec().throw();
		}else if(typeof this.socket.readyState!='number'){
			this.log.throwType("this.socket to be instance of ws/Websocket",this.socket);
		}else if(this.socket.onclose){
			this.log.warn("Listeners already set on this.socket").setCode('EALREADY').exec();
		}else{
			this.log.debug("Regisering listners on websocket...")

			//Start by clearing any previously emitted events since we'll be using .after() vv, 
			this.clearEmitted('_connect');
			this.clearEmitted('_disconnect');

			//Make sure we emit a _connect event once (which will cause Server to add client to this.clients)
			if(this.connected){
				this.log.debug("Websocket was already connected...");
				this.emitOnce('_connect'); //won't do anything if already emitted by listener ^
			}else{
				this.socket.onopen=()=>{
					this.log.debug("Websocket just connected now!");
					if(!this.connected)
						this.log.error("BUGBUG: We just connected, but this.connected is:",this.connected);
					this.emitOnce('_connect')
				}
			}


			this.socket.onclose=(event)=>{
				var ble=this.log.makeError(event.reason).setCode(event.code);
				if(event.wasClean){
					ble.prepend('Websocket closed cleanly.').changeLvl('debug').exec();
					this.on('_disconnect',()=>console.log('YUP, got _disconnect here...'));
					if(this.alreadyEmitted('_disconnect'))
						this.log.warn("BUGBUG: _disconnect has already been emitted, but the socket JUST CLOSED...");
					this.emitOnce('_disconnect');
				}else{
					if(!this.alreadyEmitted('_connect')){
						ble.prepend('Websocket failed to open.').setCode('CONN_FAIL',true); //true==only if no code exists
					}else{
						ble.prepend('Websocket closed.').exec();
					}
					this.emitOnce('_disconnect',ble);
				}
			};


			this.socket.onerror=(event)=>{
				if(this.connected){
					this.log.warn("Error occured, but connection still active:",event);
				}
				// else{
					//no need to do anything, the onclose listner will fire
				// }
			}

			//The message should already be a json string
			this.socket.onmessage=(event)=>{
				// console.log('uniSoc4.common.ws.onmessage',event)
				try{
					var obj = JSON.parse(event.data);
				} catch(err){
					let msg=err.message.replace('SyntaxError:','')
					this.log.makeEntry('warn',"Received badly formated JSON in message:",msg,'\n',event.data)
						.setCode('SyntaxError').exec();
					return;
				}
				this.receive(obj);
			};

		}

		return this;

	}


	uniSoc_Websocket.prototype._kill=function(){
		//If already closed, just resolve
		if(!this.socket || this.socket.readyState==this.socket.CLOSED)
			return Promise.resolve();

		//If we're in the process of connecting, call this method again after a breif timeout
		if(this.socket.readyState==this.socket.CONNECTING)
			return bu.sleep(100).then(()=>this._kill());
		
		//First start listening for the 'close' event
		var {promise,resolve}=bu.exposedPromise(3000)
		this.socket.addEventListener('close',resolve);

		//At this point the only possible states should be OPEN and CLOSING, and unless it's closing
		//we start to close now. Otherwise we just wait for the timeout vv
		if(this.socket.readyState!=this.socket.CLOSING)
			this.socket.close();

		//...and if in 3 seconds we're not disconnected, force it
		return promise.catch(err=>{
			if(err=='timeout'){
				if(this.socket && this.socket.readyState!=this.socket.CLOSED){
					let msg='Socket still not closed after 3 sec';
					if(this.socket.terminate){
						this.log.warn(msg+', forcing it...');
						this.socket.terminate(); //only available on server-side, ie. part of npm ws module
					}else{
						this.log.warn(msg+'...');
					}
				}else{
					this.log.note("BUGBUG: socket closed but 'close' event didn't fire...");
				}
				return; //This resolves the promise which causes .disconnect() to emit _disconnect... even
						//though we maaaaay still be connected
			}else{
				return Promise.reject(err);
			}
		});
	}



	/*
	* Transmit an object over websocket (turning it into json string first);
	*
	* @param any obj
	*
	* @return Promise(true)
	*/
	uniSoc_Websocket.prototype._transmit=function(payload){
		// console.debug('PAYLOAD:',payload);
		let str=JSON.stringify(payload);
		this.log.trace(payload.id+": Transmitting...",bu.logVar(str,50,'noLog'));
		this.socket.send(str, (err)=>this.afterTransmit(err,payload)); 
	}





	uniSoc.Client=uniSoc_Client;
	uniSoc.Websocket=uniSoc_Websocket;

	return uniSoc;
}

//simpleSourceMap=
//simpleSourceMap2=