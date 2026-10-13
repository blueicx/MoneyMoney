const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');const {JSDOM}=require('jsdom');
test('public core script is preloaded in head without bypassing the authenticated execution gate',()=>{
 const dom=new JSDOM(fs.readFileSync('dist/web/public/index.html','utf8'));
 const link=dom.window.document.head.querySelector('link[rel=preload][data-dashboard-core-preload]');assert.ok(link,'head should download the immutable core while auth is checked');
 assert.equal(link.getAttribute('as'),'script');assert.match(link.getAttribute('href'),/^\/assets\/dashboard-startup-runtime\.[a-f0-9]+\.js$/);
 assert.equal(dom.window.document.querySelector(`script[src="${link.getAttribute('href')}"]`),null,'the preload must not execute private initialization early');dom.window.close();
});
