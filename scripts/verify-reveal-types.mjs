import assert from 'node:assert/strict';
import { revealTypeForCard } from '../src/data/revealType.ts';
import { speciesRevealType } from '../src/data/pokemonTypes.ts';
import { makeFireflyRoute, sampleFirefly } from '../src/effects/bugMotion.ts';
import { Vector3 } from 'three';

const cases = [
    ['Caterpie',10,'bug'],['Butterfree',12,'bug'],['Weedle',13,'bug'],['Scyther',123,'bug'],
    ['Skorupi',451,'poison'],['Snom',872,'ice'],['Pidgeotto',17,'flying'],['Eevee',133,undefined],
    ['Charizard',6,'fire'],['Lapras',131,'water'],['Dewgong',87,'water'],['Jynx',124,'ice'],
    ['Bulbasaur',1,'grass'],['Gligar',207,'ground'],['Hawlucha',701,'fighting'],['Abra',63,'psychic'],
    ['Galarian Articuno',144,'psychic'],['Galarian Slowbro',80,'poison'],['Galarian Slowking',199,'poison'],
    ['Galarian Darmanitan',555,'ice'],['Galarian Darmanitan Zen Mode',555,'ice'],
    ['Hisuian Sneasel',215,'fighting'],['Alolan Sandshrew',27,'ice'],['Alolan Marowak',105,'fire'],
    ['Paldean Wooper',194,'poison'],['Galarian Farfetch’d',83,'fighting'],['Galarian Yamask',562,'ground'],
    ['Paldean Tauros',128,'fighting'],['Paldean Tauros Aqua Breed',128,'fighting'],['Hisuian Qwilfish',211,'poison'],
    ['Gengar',94,'poison'],['Geodude',74,'rock'],['Garchomp',445,'ground'],
    ['Alolan Raichu',26,'electric'],['M Charizard X EX',6,'fire'],['Mega Pinsir',127,'bug'],
    ['Wash Rotom',479,'electric'],['Shaymin Sky Forme',492,'grass'],['Ice Rider Calyrex',898,'psychic'],
    ['Shadow Rider Calyrex',898,'psychic'],['Great Tusk ex',984,'ground'],['Bloodmoon Ursaluna ex',901,'ground'],
    ["Brock's Sandshrew",27,'ground'],["Falkner’s Pidgeot ex",18,'flying'],['Nidoran ♀',29,'poison'],
];
for(const [name,dex,type] of cases) {
    for(const dexId of [[dex],[]]) {
        const card={name,dexId,types:['Grass'],image:''};
        assert.equal(speciesRevealType(card),type,`${name}, dex ${dexId}`);
        if(type) assert.equal(revealTypeForCard(card),type,name);
    }
}
assert.equal(revealTypeForCard({name:'Unknown',dexId:[],types:['Lightning'],image:''}),'electric');
assert.equal(revealTypeForCard({name:'Eevee',dexId:[133],types:['Colorless'],image:''}),'psychic');
assert.equal(revealTypeForCard({name:'Butterfree & Lapras',dexId:[99999,12,131],types:['Water'],image:''}),'bug');
assert.equal(revealTypeForCard({name:'Lapras & Butterfree',dexId:[131,12],types:['Grass'],image:''}),'water');

// Flight continuity is behavior, not a comparison against shader source text.
const epsilon=0.00001;
for(let i=0;i<36;i++) {
    const route=makeFireflyRoute(i), before=new Vector3(), after=new Vector3(), at=new Vector3();
    for(let time=0.05;time<3.5;time+=0.05) {
        sampleFirefly(route,time-epsilon,before); sampleFirefly(route,time,at); sampleFirefly(route,time+epsilon,after);
        assert.ok(before.distanceTo(after)<0.0001,'No position jump during flight');
        before.sub(at).divideScalar(-epsilon); after.sub(at).divideScalar(epsilon);
        assert.ok(before.distanceTo(after)<0.002,'Continuous velocity throughout the flight');
        assert.ok(after.length()>0.035,'No repeated waypoint stops or clamped endpoint');
    }
    sampleFirefly(route,1.25,before); sampleFirefly(route,3.2,after); sampleFirefly(route,1.25,after);
    assert.deepEqual(before.toArray(),after.toArray(),'Seek is deterministic');
}
const swarm=Array.from({length:36},(_,i)=>{const point=new Vector3();sampleFirefly(makeFireflyRoute(i),1.25,point);return point;});
for(const axis of ['x','y','z']) {
    const values=swarm.map(point=>point[axis]);
    assert.ok(Math.max(...values)-Math.min(...values)>(axis==='x'?1.5:axis==='y'?0.75:0.7),`Swarm occupies a broad ${axis} range`);
}
console.log(`${cases.length*2+4} routing cases and 36 continuous, deterministic firefly routes passed.`);
