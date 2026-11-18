import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {geometryAnchor,geometryBounds,geometryPolygons,matchesScore,regionKey,scoreTier} from '../frontend/src/commercial-map.mjs';

const rectangle=(x1,y1,x2,y2)=>[[x1,y1],[x2,y1],[x2,y2],[x1,y2],[x1,y1]];
test('boundary paths preserve multipolygons and holes; anchor remains outside the hole',()=>{
  const geometry={type:'Polygon',coordinates:[rectangle(0,0,10,10),rectangle(3,3,7,7)]};
  assert.deepEqual(geometryBounds(geometry),[0,0,10,10]);
  const [x,y]=geometryAnchor(geometry);
  assert.equal(y,5);
  assert(x<3 || x>7);
  assert(x>0 && x<10);
  assert.equal(geometryPolygons(geometry)[0].length,2);
  const multi={type:'MultiPolygon',coordinates:[geometry.coordinates,[rectangle(20,20,21,21)]]};
  assert.equal(geometryPolygons(multi).length,2);
  assert.deepEqual(geometryBounds(multi),[0,0,21,21]);
  assert(geometryAnchor(multi)[0]<10);
});
test('map filters preserve real scores, including zero and unavailable scores',()=>{
  assert.equal(matchesScore(0,'all'),true);
  assert.equal(matchesScore(null,'80'),false);
  assert.equal(matchesScore(80,'80'),true);
  assert.equal(matchesScore(59,'under60'),true);
  assert.equal(scoreTier(85),'blue');
  assert.equal(scoreTier(74),'green');
  assert.equal(scoreTier(60),'amber');
  assert.equal(scoreTier(null),'none');
  assert.equal(regionKey('부산진구','부전제1동'),regionKey('부산진구','부전1동'));
});
test('bundled boundaries cover 206 unique Busan administrative dongs with real coordinates',()=>{
  const data=JSON.parse(readFileSync(new URL('../frontend/public/data/busan-dongs.geojson',import.meta.url)));
  assert.equal(data.features.length,206);
  const ids=new Set(),names=new Set();
  for(const feature of data.features){
    assert.match(feature.properties.code,/^26\d{8}$/);
    ids.add(feature.properties.code);names.add(regionKey(feature.properties.district_name,feature.properties.dong_name));
    const bounds=geometryBounds(feature.geometry),anchor=geometryAnchor(feature.geometry);
    assert(bounds[0]>128 && bounds[2]<130 && bounds[1]>34 && bounds[3]<36);
    assert(anchor && anchor.every(Number.isFinite));
    assert(anchor[0]>=bounds[0]&&anchor[0]<=bounds[2]);
    assert(anchor[1]>=bounds[1]&&anchor[1]<=bounds[3]);
  }
  assert.equal(ids.size,206);assert.equal(names.size,206);
});
