// @vitest-environment jsdom
// Восьмой аудит, K01: отпускание забранного D, потерянное через blur, не съедает keyup следующего Ctrl+D.
import {readFileSync} from 'node:fs';
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
vi.mock('@core/log',()=>({log:{debug(){},info(){},warn(){},error(){}}}));
import {keyboard} from '@core/keyboard';
const fixture=readFileSync('tests/fixtures/bundle-snippets/room-hotkeys.txt','utf8').split('\n').slice(1).join('\n');
const factory=new Function('window','document','navigator',`var ${fixture.slice(0,fixture.indexOf('var _h=gh;'))};return gh;`);
let hk:any,off:()=>void,nativeD:number,nativeV:number;
function key(code:string,type='keydown',extra:KeyboardEventInit={}){const kc=code==='ControlLeft'?17:code.charCodeAt(3);const e=new KeyboardEvent(type,{code,key:code.slice(3).toLowerCase(),keyCode:kc,which:kc,bubbles:true,cancelable:true,...extra});document.dispatchEvent(e);return e;}
function ctrlTap(code:string){key('ControlLeft','keydown',{ctrlKey:true});key(code,'keydown',{ctrlKey:true});key(code,'keyup',{ctrlKey:true});key('ControlLeft','keyup');}
beforeEach(()=>{document.body.innerHTML='';nativeD=nativeV=0;hk=factory(window,document,navigator);hk('ctrl+d',(e:KeyboardEvent)=>{e.preventDefault();nativeD++;return false;});hk('ctrl+v',(e:KeyboardEvent)=>{e.preventDefault();nativeV++;return false;});off=keyboard.register('KeyD',()=>{}, {preventDefault:true});});
afterEach(()=>{off();window.dispatchEvent(new Event('blur'));window.dispatchEvent(new Event('focus'));hk.unbind();key('KeyD','keyup');});
test('swallowed D-down then lost up/blur must not swallow a later native Ctrl+D-up',()=>{
 key('KeyD'); // owned by us; the site never saw this down
 window.dispatchEvent(new Event('blur')); // Alt-tab; old keyup happened elsewhere
 window.dispatchEvent(new Event('focus')); // native hotkeys resets pressed state
 ctrlTap('KeyD');const afterRelease=hk.getPressedKeyCodes().slice();
 ctrlTap('KeyV');
 expect({nativeD,nativeV,afterRelease}).toEqual({nativeD:1,nativeV:1,afterRelease:[]});
});
test('CONTROL accepted native Ctrl+D and its keyup belong to native dispatcher',()=>{
 ctrlTap('KeyD');const afterRelease=hk.getPressedKeyCodes().slice();ctrlTap('KeyV');expect({nativeD,nativeV,afterRelease}).toEqual({nativeD:1,nativeV:1,afterRelease:[]});
});
test.each(['KeyD','KeyJ'])('CONTROL plain owned logical D takes matching up, code=%s',code=>{
 off();off=keyboard.register(code,()=>{}, {preventDefault:true});const atDoc=vi.fn();document.addEventListener('keyup',atDoc);const init={keyCode:68,which:68,key:'d'};key(code,'keydown',init);key(code,'keyup',init);document.removeEventListener('keyup',atDoc);expect(atDoc).not.toHaveBeenCalled();expect(hk.getPressedKeyCodes()).toEqual([]);
});
