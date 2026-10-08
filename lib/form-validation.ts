export function validateForm(form: HTMLFormElement, notify: (text: string) => void): boolean {
 const fields=Array.from(form.elements).filter((e): e is HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement => e instanceof HTMLInputElement || e instanceof HTMLSelectElement || e instanceof HTMLTextAreaElement);
 const invalid=fields.filter(e=>!e.disabled && (!e.validity.valid || (e.required && !e.value.trim())));
 for(const field of fields) field.setAttribute('aria-invalid',invalid.includes(field)?'true':'false');
 if(!invalid.length) return true;
 const names=invalid.map(field=>{const node=field.labels?.[0]?.cloneNode(true) as HTMLElement|undefined;node?.querySelectorAll('input,select,textarea,.required-mark').forEach(e=>e.remove());const label=node?.textContent?.replace(/\s+/g,' ').trim() || field.name || 'Fält'; const why=field.validity.typeMismatch?'ange ett giltigt värde':field.validity.tooShort?`minst ${field instanceof HTMLInputElement?field.minLength:8} tecken`:field.validity.rangeUnderflow||field.validity.rangeOverflow?'värdet ligger utanför tillåtet intervall':'fyll i eller korrigera uppgiften';return `${label}: ${why}`;});
 notify('Kontrollera följande fält: '+names.join(' · '));
 invalid[0].focus();invalid[0].scrollIntoView({block:'center',behavior:'smooth'});return false;
}
