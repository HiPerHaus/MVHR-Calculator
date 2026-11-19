// View-only optimisations. Callers supply immutable project snapshots; domain
// validation still runs when importing, executing, undoing or redoing commands.
export function createSnapshotMemo(read) {
  const values=new WeakMap();
  return snapshot=>{
    if(!values.has(snapshot))values.set(snapshot,read(snapshot));
    return values.get(snapshot);
  };
}
export function createTrailingViewTask(run,{delay=150,schedule=(fn,ms)=>setTimeout(fn,ms),cancel=id=>clearTimeout(id)}={}) {
  let timer=null;
  return {
    schedule(){if(timer!==null)cancel(timer);timer=schedule(()=>{timer=null;run();},delay);},
    flush(){if(timer===null)return;cancel(timer);timer=null;run();},
  };
}
