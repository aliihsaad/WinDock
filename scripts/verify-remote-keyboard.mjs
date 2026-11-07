import { createChecker } from './lib/assert.mjs';
import { createRemoteKeyboard } from '../public/remote-keyboard.js';
import { validateInput } from '../src/input.js';

const t = createChecker('remote-keyboard');
class Element extends EventTarget {
  dataset = {}; hidden = false; disabled = false; value = ''; attrs = {};
  classList = { toggle() {}, remove() {} };
  setAttribute(key, value) { this.attrs[key] = value; }
  focus() {} blur() {}
  click() { this.dispatchEvent(new Event('click')); }
}
function harness(bridge) {
  const elements = new Map();
  const get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const names = ['Escape', 'Tab', 'Delete', 'Home', 'End', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'ArrowRight'];
  const keys = names.map(name => { const key = new Element(); key.dataset.pcKey = name; return key; });
  get('pc-keys').querySelectorAll = () => keys;
  globalThis.document = { getElementById: get };
  globalThis.window = Object.assign(new EventTarget(), { WinDockAndroid: bridge });
  const sent = []; let ready = true;
  const keyboard = createRemoteKeyboard({ send: message => { sent.push(message); return true; }, isReady: () => ready, onSignature() {}, notify() {} });
  const announce = target => keyboard.message({type:'focus', target, editable:false, password:false});
  return {keyboard, keys, get, sent, announce, setReady(value) {ready=value; keyboard.paint();}};
}
{
  const h = harness();
  h.keyboard.configure(false);
  t.ok(h.get('pc-keys').hidden, 'unsupported hosts hide the key strip');
  h.keyboard.configure(true);
  t.ok(h.get('pc-keys').hidden, 'PC keys start hidden');
  h.get('pc-keys-toggle').click();
  t.ok(!h.get('pc-keys').hidden, 'the toggle shows PC keys');
  h.keys[0].click();
  t.equal(h.sent.length, 0, 'no key is sent without a host focus token');
  h.announce('12');
  for (const key of h.keys) {
    key.click();
    t.deepEqual(h.sent.at(-1), {type:'key',key:key.dataset.pcKey,target:'12'}, 'PC keys work without opening the phone keyboard');
    t.ok(validateInput(h.sent.at(-1)), 'each key is accepted by the existing host protocol');
  }
  const count = h.sent.length;
  h.get('pc-keys-toggle').click(); h.keys[0].click();
  t.ok(h.get('pc-keys').hidden && h.sent.length===count, 'hidden keys cannot send queued clicks');
  h.get('pc-keys-toggle').click();
  h.keyboard.touch(true);
  h.get('pc-keys-toggle').click();
  t.ok(!h.get('pc-keys').hidden, 'touch also blocks accidental toggle changes');
  t.ok(h.keys.every(key=>key.disabled), 'touch disables every PC key');
  h.keys[0].click();
  t.equal(h.sent.length,count,'even a queued click during touch sends nothing');
  h.keyboard.touch(false);
  t.ok(h.keys.every(key=>!key.disabled),'finger lift re-enables keys');
  h.announce('13'); h.keys[0].click();
  t.equal(h.sent.at(-1).target,'13','focus changes use the new token');
  h.setReady(false); h.keys[0].click();
  t.equal(h.sent.length,count+1,'disconnect blocks key actions');
  h.setReady(true); h.keyboard.suspend(true); h.keys[0].click();
  t.equal(h.sent.length,count+1,'clipboard editing suspends PC keys');
  h.keyboard.suspend(false); h.keyboard.reset(); h.keys[0].click();
  t.equal(h.sent.length,count+1,'reset discards the old focus token');
}
{
  const h = harness(); h.keyboard.configure(true); h.get('pc-keys-toggle').click(); h.announce('22');
  h.get('touchpad-keyboard').click(); h.sent.length=0;
  h.get('remote-keyboard-text').value='mixedCase ';
  h.keys[3].click();
  t.deepEqual(h.sent,[{type:'text',text:'mixedCase ',target:'22'},{type:'key',key:'Home',target:'22'}],'browser draft is sent before a PC navigation key');
  h.get('remote-keyboard-text').dispatchEvent(new Event('compositionstart'));
  h.keys[4].click();
  t.equal(h.sent.length,2,'unfinished composition is not reordered by a PC key');
  h.get('remote-keyboard-text').dispatchEvent(new Event('compositionend'));
  t.ok(h.keys.every(key=>!key.disabled),'composition end restores keys');
}
{
  const calls=[];
  const h = harness({showKeyboard(){},hideKeyboard(){},pressKeyboardKey(target,key){calls.push({target,key});}});
  h.keyboard.configure(true); h.get('pc-keys-toggle').click(); h.announce('31'); h.get('touchpad-keyboard').click(); h.sent.length=0;
  h.keys[4].click();
  t.deepEqual(calls,[{target:'31',key:'End'}],'native composition is committed by the Android bridge before navigation');
  t.equal(h.sent.length,0,'web code does not race a direct key against native draft commit');
  const emit = detail => {const event=new Event('windock-keyboard-input');event.detail=detail;window.dispatchEvent(event);};
  emit({type:'key',key:'End',target:'30'});
  t.equal(h.sent.length,0,'stale native focus events are ignored');
  emit({type:'text',text:'Word',target:'31'});emit({type:'key',key:'End',target:'31'});
  t.deepEqual(h.sent,[{type:'text',text:'Word',target:'31'},{type:'key',key:'End',target:'31'}],'native text and key events retain their order and case');
}
{
  const h=harness({showKeyboard(){},hideKeyboard(){}});
  h.keyboard.configure(true);h.get('pc-keys-toggle').click();h.announce('41');h.get('touchpad-keyboard').click();h.sent.length=0;
  t.ok(h.keys.every(key=>key.disabled),'older APK disables PC keys during native composition');
  h.keys[0].click();t.equal(h.sent.length,0,'older APK never loses a native draft to a PC key');
  h.keyboard.close();h.keys[0].click();t.equal(h.sent.length,1,'older APK can use PC keys with the IME closed');
}
t.done('remote-keyboard verification passed');
