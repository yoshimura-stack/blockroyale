// Normalize only full-width ASCII; preserve case and other characters.
export const normalizeEntryCode = value => String(value ?? '').replace(/[！-～]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xfee0)).trim();
export function bindEntryCode(input){
 const convert=()=>{
  const value=input.value.replace(/[！-～]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xfee0));
  if(value===input.value)return;
  const start=input.selectionStart,end=input.selectionEnd;
  input.value=value;
  if(start!==null&&start!==undefined)input.setSelectionRange?.(start,end);
 };
 input.oninput=e=>{if(!e.isComposing)convert();};
 input.oncompositionend=convert;
 input.onblur=()=>{input.value=normalizeEntryCode(input.value);};
}
