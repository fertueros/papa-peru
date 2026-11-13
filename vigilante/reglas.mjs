const ciudades = new Set(['Callao','Lima','Pimentel','Chiclayo (La Victoria)','Chiclayo','Santa Cruz de Succhabamba','Zaña','Cusco','Pucallpa (Yarinacocha)','Pucallpa (Manantay)','Lima (Santiago de Surco)']);
export function revisar(agenda) {
 const errores=[];let anterior=-Infinity;const ids=new Set();
 for(const p of agenda.paradas){
  const time=Date.parse(p.inicio);
  if(!Number.isFinite(time)||!p.inicio.endsWith('-05:00')||time<anterior)errores.push('horas de actos fuera de orden');
  anterior=time;
  if(!ciudades.has(p.ciudad))errores.push('lugar fuera del vocabulario peruano');
  if(!['ceremonia','encuentro','visita','misa'].includes(p.tipo))errores.push('acto no reconocido');
  if(!p.id||ids.has(p.id))errores.push('id duplicado o ausente');ids.add(p.id);
 }
 anterior=-Infinity;
 for(const t of agenda.tramos){const s=Date.parse(t.salida),l=Date.parse(t.llegada);if(!Number.isFinite(s)||!Number.isFinite(l)||s>=l||s<anterior)errores.push('horas de tramos fuera de orden');anterior=l;}
 return [...new Set(errores)];
}
