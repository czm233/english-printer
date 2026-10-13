const fs = require('node:fs');
const sdk = require('./lpapi.cjs');
if (process.argv[2] === 'query') {
 fs.writeFileSync('query.bin', Buffer.concat([112,113,114,66,69].map(c=>Buffer.from(new sdk.DzPackage(c).getBytes()))));
} else {
 const rgba = fs.readFileSync('label.rgba');
 if (rgba.length !== 240*96*4) throw Error('Invalid raster size');
 const packets = sdk.PrintPackage.encodeImageData({imageData:{width:240,height:96,data:new Uint8ClampedArray(rgba)},orientation:90,gapType:2,gapLength:3,printDarkness:255,printSpeed:255,pageKey:1,enableSuperBitmap:false},{printerDPI:203,printerWidth:96,hardwareFlags:0,softwareFlags:0});
 if (!packets.length) throw Error('No print data');
 fs.writeFileSync('print.bin',Buffer.concat(packets.map(p=>Buffer.from(p))));
 console.log('Encoded one label:',fs.statSync('print.bin').size,'bytes');
}
