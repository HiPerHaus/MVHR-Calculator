const PREFIX="hiper-lzw-v1:";

// Lossless storage encoding only; portable project files keep their existing format.
export function encodeStorageText(text) {
  if(text.length<1024)return text;
  const bytes=new TextEncoder().encode(text),dict=new Map();
  let next=256,word="",binary="";
  const emit=code=>{binary+=String.fromCharCode(code);};
  for(const byte of bytes) {
    const char=String.fromCharCode(byte),joined=word+char;
    if(joined.length===1 || dict.has(joined)){word=joined;continue;}
    emit(word.length===1?word.charCodeAt(0):dict.get(word));
    if(next<65536)dict.set(joined,next++);
    word=char;
  }
  if(word)emit(word.length===1?word.charCodeAt(0):dict.get(word));
  const encoded=PREFIX+binary;
  return encoded.length<text.length?encoded:text;
}

export function decodeStorageText(text) {
  if(text===null || !text.startsWith(PREFIX))return text;
  const binary=text.slice(PREFIX.length);
  const dict=Array.from({length:256},(_,i)=>String.fromCharCode(i));
  let next=256,previous="",chunks=[];
  for(let i=0;i<binary.length;i++) {
    const code=binary.charCodeAt(i);
    const word=dict[code]??(code===next && previous?previous+previous[0]:null);
    if(word===null)throw new TypeError("Invalid compressed project storage code");
    chunks.push(word);
    if(previous && next<65536)dict[next++]=previous+word[0];
    previous=word;
  }
  const data=chunks.join("");
  return new TextDecoder("utf-8",{fatal:true}).decode(Uint8Array.from(data,c=>c.charCodeAt(0)));
}

export function createCompactProjectStorage(storage) {
  return {
    getItem(key){return decodeStorageText(storage.getItem(key));},
    setItem(key,value){storage.setItem(key,encodeStorageText(value));},
    removeItem(key){storage.removeItem(key);},
  };
}

// Replace only this application's plain records with a smaller, round-trip verified
// encoding. Atomic per-key replacement keeps the old value if browser quota rejects it.
export function compactExistingProjectStorage(storage) {
  const keys=Array.from({length:storage.length},(_,i)=>storage.key(i)).filter(k=>/^hiper-studio:/.test(k));
  for(const key of keys) {
    const original=storage.getItem(key);
    if(original===null || original.startsWith(PREFIX))continue;
    const compact=encodeStorageText(original);
    if(compact===original || decodeStorageText(compact)!==original)continue;
    try { storage.setItem(key,compact); } catch {
      // A denied replacement leaves the original readable; still allow reopening.
    }
  }
}
