import assert from 'node:assert/strict';
import { requestedAddress, matchesHouse, addressKey, isVerifiedCoordinate, isExactCoordinate } from '../src/services/addressPrecision.js';
import { geocodeAddress } from '../src/services/geocoding.js';
const address = 'Avenida Afonso Pena 547';
const house = (number, road='Avenida Afonso Pena', city='Uberlândia', lat='-18.92', lon='-48.28') => ({lat,lon,address:{house_number:number,road,city}});
assert.deepEqual(requestedAddress(address),{number:'547',road:'afonso pena'});
assert.equal(requestedAddress('Av. Afonso Pena, 547, Centro, Uberlândia MG').number,'547');
assert.equal(requestedAddress('Rua 13 de Maio 547').number,'547');
assert.equal(requestedAddress('Rua 13 de Maio, 547').number,'547');
assert.equal(requestedAddress('Rua 13 de Maio').number,'');
assert.equal(requestedAddress('Av Afonso Pena nº 547, Centro').number,'547');
assert.equal(matchesHouse(address,house('2547')),false);
assert.equal(matchesHouse(address,house('')),false);
assert.equal(matchesHouse(address,house('547','Rua Floriano Peixoto')),false);
assert.equal(matchesHouse(address,house('547')),true);
// Ponto utilizável: não exige número exato, mas recusa coordenada inválida ou de outro endereço.
assert.equal(isVerifiedCoordinate(address,{lat:-18.92,lng:-48.28}),false,'ponto antigo sem vinculo nao e destino confirmado');
assert.equal(isVerifiedCoordinate(address,{lat:-18.92,lng:-48.28,geocodePrecision:'street',verifiedAddressKey:addressKey(address)}),false);
assert.equal(isVerifiedCoordinate('Avenida Afonso Pena 549',{lat:-18.92,lng:-48.28,verifiedAddressKey:addressKey(address)}),false,'endereço editado');
assert.equal(isVerifiedCoordinate(address,{lat:91,lng:-48.28}),false);
assert.equal(isVerifiedCoordinate(address,null),false);
const manual={lat:-18.92,lng:-48.28,geocodePrecision:'manual',verifiedAddressKey:addressKey(address)};
assert.equal(isExactCoordinate(address,manual),true);
assert.equal(isExactCoordinate(address,{lat:-18.92,lng:-48.28,geocodePrecision:'street',verifiedAddressKey:addressKey(address)}),false);

const store = new Map(); globalThis.window={localStorage:{getItem:(key)=>store.get(key),setItem:(key,val)=>store.set(key,val),removeItem:(key)=>store.delete(key)}};
const context={city:'Uberlândia',uf:'MG'}, origin={lat:-18.92,lng:-48.28};
let mode='street', cepCalls=0, searchCalls=0, cepOk=true;
globalThis.fetch=async (url) => {
 if(url.includes('cep.awesomeapi')) {cepCalls++; return cepOk?{ok:true,json:async()=>({lat:-18.91,lng:-48.27,city:'Uberlândia'})}:{ok:false,json:async()=>({})};}
 if(url.includes('viacep')) return {ok:true,json:async()=>({logradouro:'Avenida Afonso Pena',bairro:'Centro',localidade:'Uberlândia',uf:'MG'})};
 searchCalls++;
 const data = {
  street: [house('2547'),house('')],                                   // rua certa, sem o número 547 no mapa
  foreign: [house('547','Avenida Afonso Pena','Araguari','-18.64','-48.19')], // outra cidade, ~35 km
  exact: [house('2547'),house('547')],
  wrongRoad: [house('547','Avenida Floriano Peixoto')],
  nearbyForeign: [house('547','Avenida Afonso Pena','Araguari','-18.921','-48.281')],
  none: [],
 }[mode];
 return {ok:true,json:async()=>data};
};
// 1) Número ausente no mapa: NÃO bloqueia, usa a rua.
let c=await geocodeAddress(address,{context,origin});
assert.equal(c.geocodePrecision,'street'); assert.equal(isVerifiedCoordinate(address,c),false);
// 2) Cidade errada e longe: ignora e usa o CEP como reserva.
store.clear(); mode='foreign'; c=await geocodeAddress(address+', 38400-000',{context,origin});
assert.equal(c.geocodePrecision,'cep'); assert.ok(cepCalls>0,'CEP consultado'); assert.equal(c.lat,-18.91);
// 3) Número exato: ponto exato.
store.clear(); mode='exact'; c=await geocodeAddress(address,{context,origin});
assert.equal(c.geocodePrecision,'house'); assert.equal(c.houseNumber,'547'); assert.equal(isExactCoordinate(address,c),true);
// 4) Cache reaproveitado.
const before=searchCalls; await geocodeAddress(address,{context,origin}); assert.equal(searchCalls,before,'cache reutilizado');
// Não aceitar outra rua nem outra cidade, mesmo que o ponto esteja perto.
store.clear(); mode='wrongRoad';
await assert.rejects(()=>geocodeAddress(address,{context,origin}),/Não foi possível localizar o endereço/);
store.clear(); mode='nearbyForeign';
await assert.rejects(()=>geocodeAddress(address,{context,origin}),/Não foi possível localizar o endereço/);
for (const value of [null, '', ' ', false]) {
 assert.equal(isVerifiedCoordinate(address,{lat:value,lng:value,geocodePrecision:'manual',verifiedAddressKey:addressKey(address)}),false);
}
// 5) Nada encontrado em lugar nenhum: erro claro (único caso que pede ajuda do usuário).
store.clear(); mode='none'; cepOk=false;
await assert.rejects(()=>geocodeAddress('Rua Inexistente 10',{context,origin}),/Não foi possível localizar o endereço/);
console.log('Endereços: parser, rua sem número, cidade errada, CEP reserva, número exato, cache e erro final OK');
