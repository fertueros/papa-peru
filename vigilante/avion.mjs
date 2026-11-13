import fuentes from './fuentes.json' with { type:'json' };
export async function leerAvion(agenda,vuelos,now,fetcher,onConsulta=()=>{}){
 const hora=Date.parse(now);
 const tramo=agenda.tramos.find(t=>t.medio==='avion'&&t.estado!=='ya_no_figura'&&hora>=Date.parse(t.salida)-900000&&hora<=Date.parse(t.llegada)+1800000);
 if(!tramo)return null;
 const id=vuelos[tramo.id];const callsign=id?.callsign?.trim().toUpperCase(),hex=id?.hex?.toLowerCase();
 if(!callsign&&!hex)return null;
 if((callsign&&!/^[A-Z0-9]{2,10}$/.test(callsign))||(hex&&!/^[a-f0-9]{6}$/.test(hex)))return null;
 const url=hex?`${fuentes.avion}/hex/${hex}`:`${fuentes.avion}/callsign/${callsign}`;
 // A round performs at most one ADS-B request; workflow concurrency serializes rounds.
 onConsulta();const response=await fetcher(url);if(!response.ok)throw Error('adsb');const data=await response.json();
 const matches=(data.aircraft??data.ac??[]).filter(p=>(callsign&&p.flight?.trim().toUpperCase()===callsign)||(hex&&p.hex?.toLowerCase()===hex));
 if(matches.length!==1)return null;const p=matches[0];
 if(!Number.isFinite(p.lat)||!Number.isFinite(p.lon)||Math.abs(p.lat)>90||Math.abs(p.lon)>180||!Number.isFinite(p.alt_baro)||p.alt_baro<=0||!Number.isFinite(p.seen_pos)||p.seen_pos<0||p.seen_pos>120)return null;
 const observed=Number(data.now);const timestamp=(observed>1e12?observed:observed*1000)-p.seen_pos*1000;
 if(!Number.isFinite(timestamp)||hora-timestamp>120000||timestamp>hora||timestamp<Date.parse(tramo.salida))return null;
 return {tramo:tramo.id,lat:p.lat,lon:p.lon,alt_m:Math.round(p.alt_baro*0.3048),hora:new Date(timestamp).toISOString(),fuente:'adsb.fi',fuente_url:'https://adsb.fi/'};
}
