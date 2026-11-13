import fuentes from './fuentes.json' with {type:'json'};
export async function leerClima(agenda,now,fetcher){
 const ciudades=[...new Map(agenda.paradas.filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon)).map(p=>[p.ciudad_id,p])).values()];
 const url=new URL(fuentes.clima);for(const [k,v] of Object.entries({latitude:ciudades.map(p=>p.lat).join(','),longitude:ciudades.map(p=>p.lon).join(','),current:'temperature_2m,weather_code',hourly:'precipitation_probability',daily:'temperature_2m_max,temperature_2m_min,precipitation_probability_max',timezone:'America/Lima',forecast_days:7}))url.searchParams.set(k,v);
 const r=await fetcher(url);if(!r.ok)throw Error('clima');const result=await r.json();const datos=Array.isArray(result)?result:[result];if(datos.length!==ciudades.length)throw Error('clima incompleto');
 const salida={actualizado:now,fuente:'Open-Meteo',fuente_url:'https://open-meteo.com/',ciudades:{}};
 datos.forEach((d,i)=>{if(!Number.isFinite(d.current?.temperature_2m)||!Number.isFinite(d.current?.weather_code)||!d.current?.time||!Array.isArray(d.daily?.time))throw Error('clima inválido');
 const index=d.hourly?.time?.indexOf(d.current.time.slice(0,13)+':00');
 salida.ciudades[ciudades[i].ciudad_id]={temp:d.current.temperature_2m,cielo:d.current.weather_code,lluvia_prob:d.hourly?.precipitation_probability?.[index]??null,hora:d.current.time+'-05:00',dias:Object.fromEntries(d.daily.time.map((dia,j)=>[dia,{max:d.daily.temperature_2m_max[j],min:d.daily.temperature_2m_min[j],lluvia_prob:d.daily.precipitation_probability_max[j]}]))};});return salida;
}
