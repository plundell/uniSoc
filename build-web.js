;'use strict';
/*
* @module uniSoc
* @author plundell
* @license Apache-2.0
* @description Frontend component of uniSoc. Wraps around native WebSocket API (https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
* @extends ./unisoc-common.js   
* @depends libbetter
* @exports n/a      This script should be bundled and loaded in the browser directly. It make the module available 
*                   at window.uniSoc. If you don't want that you can instead require the web-component of uniSoc ./src/web.js
*/

(function loadUniSoc(){
    if(typeof window!='object' || !window)
        throw new Error("ESCOPE. Could not access the 'window' object. Cannot load uniSoc.");

    var exporter=require("./src/web.js");

    //Create a getter on the window which runs the exporter as soon as all dependencies are
    //available OR throws a clear error if we try to access it too early
    Object.defineProperty(window,'uniSoc',{enumerable:true, configurable:true
    	,get:()=>{
    		if(window.BetterLog && window.BetterEvents && window.BetterUtil){ 
    			return window.uniSoc=exporter(window);
    		}else{
    			throw new Error("E_DEPENDENCY. uniSoc depends on libbetter which should be set on the window.");
    		}
    	}
    	//This setter allows^ the whole thing to easily be undone/overwritten
    	,set:(val)=>{
    		Object.defineProperty(window,'uniSoc',{value:val,enumerable:true,writable:true,configurable:true}); 
    		return val;
    	} 
    })
}())
