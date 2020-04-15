# uniSoc
Lightweight socket wrapper that works over ws, net, dgram and ipc

## Installation
Install the npm package: `npm -i unisoc`.  


## Usage
In NodeJS:
 ```javascript
 	const uniSoc=require('unisoc');
 ```

In the browser you have 2 options:

a) Include the bundled version directly in the browser as you would any script, you will then be able to access it on `window.uniSoc`, but you'll get an error _until_ you've loaded the dependency, as so:
```html
<script src="path/to/unisoc/dist/unisoc.min.js" type="text/javascript"></script>
<script type="text/javascript">
  try{
    new window.uniSoc();
  }catch(err){
    console.error(err); // E_DEPENDENCY
  }; 
</script>
<script src="path/to/libbetter/dist/libbetter.js" type="text/javascript"></script>
<script type="text/javascript">
  var unisoc=new window.uniSoc();
</script>
```

b) Require the package into another script, initialize it with it's dependencies, then bundle that...
 ```javascript
 var libbetter=require('./path/to/libbetter/export-browser.js');
 var unisoc=new (require('xxx-framework')(libbetter));
 ```
 ...and load that in the browser
 ```html
<script src="path/to/index.js" type="text/javascript">
```