//simpleSourceMap=/my_modules/uniSoc/uniSoc4.web.js
//simpleSourceMap2=/lib/uniSoc/uniSoc4.web.js
;'use strict';
/*
* @module uniSoc
* @author plundell
* @license Apache-2.0
* @description Frontend component of uniSoc. Wraps around native WebSocket API (https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
*
* @extends ./unisoc-common.js 	
* @depends libbetter
*
* This script can be required by another script or bundled and loaded in the browser directly, making
* it available at window.uniSoc
*
*/
const uniSocCommon=require('./unisoc.common.js');

module.exports=function uniSoc_web_exporter(dep){

	dep=dep||{}
	const uniSoc=uniSocCommon(dep);
	const bu = dep.BetterUtil  					


	uniSoc_web.defaultOptions={
		reconnectTimeout:5000
	};

	

	function uniSoc_web(options){

		//Call the common constructor as 'this', which sets a few things on this incl log
		uniSoc.Websocket.call(this,Object.assign({},uniSoc_web.defaultOptions,options));

		var onconnect=()=>this.log.info('CONNECTED'); //define seperately so name in log is non <anonymous>
		this.on('_connect',onconnect);
	}
	uniSoc_web.prototype=Object.create(uniSoc.Websocket.prototype); 
	Object.defineProperty(uniSoc_web.prototype, 'constructor', {value: uniSoc_web}); 



	/*
	* Unlike backend where sockets are generated by the server and passed into the equivilent constructor
	* function, here in browser we call connect() manually. That also means that we can reconnect (creating
	* a new Websocket on this.socket without having to create a whole new uniSoc_web)
	*
	* @opt object options 		Available options (will default to those passed to constructor):
	*								host - string - if different from document hostname
	*								post - number - if different from document port
	*								auth - string - if authentication is required
	* @flag 'reconnect'  		If set then this function always returns void (and logging
	*							looks a bit different)
	*
	* @return Promise(void,<BLE>)|void 	Resolves when connected, rejects if and when connection fails
	*/
	uniSoc_web.prototype.connect=function(options,isReconnect){
		try{
			//Throw if we're already connected (will be caught vv)
			if(this.connected)
				this.log.makeError("Already connected").throw('EALREADY');

			//Make sure the flag is intentional
			isReconnect=(isReconnect=='reconnect')

			//Save any options to this object
			if(options)
				Object.assign(this.options,options);

			//Build the url
			var url='//'+(this.options.host ? this.options.host : document.location.host);
			if(this.options.port)
				url+=':'+this.options.port

			url=(document.location.protocol=='https:' ? 'wss:' : 'ws:')+url
			if(!isReconnect)
				this.log.info("Attempting to connect to websocket:",url).exec();
			this.socket=new WebSocket(url,'json'); //2020-01-31: the 'json' doesn't seem to do anything...
			this.registerAllListeners(); //will emit CONN_FAIL or _connect
			
			//Expose a promise and use it to catch those^ events
			var {promise, resolve,reject,inspect}=bu.exposedPromise(5000);
			this.once('_connect',resolve);
			this.once('_disconnect',reject);

			//Finally return said promise
			var stack=new Error().stack; //for debug purposes on fail vv
			return promise.then(
				()=>{
					//remove listener since future disconnects aren't related to connection failure...
					this.off('_disconnect',reject); 
					//...and instead add a listener that will attempt to reconnect on future disconnects
					this.once('_disconnect',()=>this.reconnect());
					return;
				}
				,(err)=>{
					this.off('_connect',resolve);
					
					//NOTE: Failed connections will be printed to the console regardless. So there is more data to
					// 		find there that cannot be included in the log

					let ble=this.log.makeError(err,this.socket).setStack(stack);
					this.socket=null;

					//If this is a failed reconnect...
					if(isReconnect){
						ble.prepend(`Reconnect failed.`);
						//The 1006 error (unexpected close) will be emitted if a server is unavailable, and it 
						//will be printed to console regardless... so if that's the case just add an entry
						//to the log without printing anything
						if(ble.code==1006){
							ble.changeLvl('debug').printed=true
							ble.exec();
						}else{
							//Else it's something special and we print it full on
							ble.exec();
						}

						//Then just trigger another attempt.... but DON'T reject
						this.reconnect();
					}else{
						return ble.reject();
					}
				}
			)
			
		}catch(err){
			let ble=this.log.makeError(err).prepend('BUGBUG:');
			if(isReconnect)
				ble.exec(); //On reconnect we just print it. NOTE: This will break the reconnect cycle
			else
				return ble.reject();
		}
		
	}

	/*
	* Trigger a reconnect (and keep fireing at an interval, which is either passed in or
	* this.options.reconnectTimeout)
	*
	* @opt number interval 	The new interval between attempts to use. If reconnect has previously
	*						 been disabled then a positive number is needed to trigger anything. The
	*						 value passed in will also be saved for future use
	* @return void
	*/
	uniSoc_web.prototype.reconnect=function(interval){
		if(interval && typeof interval=='number')
			this.options.reconnectTimeout=interval;

		interval=this.options.reconnectTimeout;

		if(interval){
			this.log.trace(`Trying to reconnect in ${interval} ms.`)
			setTimeout(()=>this.connect(null,'reconnect'),interval)
		}else{
			this.log.note("Not reconnecting. See this.options.reconnectTimeout");
		}
	}

	/*
	* Stop trying to reconnect.
	* @return void
	*/
	uniSoc_web.prototype.abortReconnect=function(){
		this.options.reconnectTimeout=null;
	}



	return uniSoc_web;
}


//simpleSourceMap=
//simpleSourceMap2=