'use strict';

const {
  normalizeVariable,
  isVariableMapped,
  assertFullyMapped,
  resolveHopModels,
  effectiveValueSourceHop,
  modelAtValueSource,
} = require('../src/services/pathMappingService');

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

const mapped = normalizeVariable({
  name: 'directorCountry',
  kind: 'scalar',
  rootModel: 'Company',
  hops: [
    {
      relatedModel: 'CompanyMember',
      filters: [{ column: 'company_member_type_id', op: 'eq', value: '1' }],
    },
    { relatedModel: 'Country', filters: [] },
  ],
  leaf: { field: 'name' },
});
assert(isVariableMapped(mapped), 'relation-path scalar should be mapped');
assertFullyMapped([mapped]);

const resolved = resolveHopModels(mapped.rootModel, mapped.hops);
assert(resolved.ok, resolved.error);
assert(resolved.leafModel === 'Country', `expected Country, got ${resolved.leafModel}`);

const legacyAssoc = normalizeVariable({
  name: 'legacyDirectorCountry',
  kind: 'scalar',
  rootModel: 'Company',
  hops: [
    {
      association: 'members',
      filters: [{ column: 'company_member_type_id', op: 'eq', value: '1' }],
    },
    { association: 'country', filters: [] },
  ],
  leaf: { field: 'name' },
});
assert(legacyAssoc.hops[0].relatedModel === 'CompanyMember', 'legacy members → CompanyMember');
assert(legacyAssoc.hops[1].relatedModel === 'Country', 'legacy country → Country');
assert(isVariableMapped(legacyAssoc), 'legacy association hops should map');

const legacy = normalizeVariable({
  name: 'companyName',
  kind: 'scalar',
  model: 'Company',
  field: 'name',
});
assert(legacy.rootModel === 'Company' && legacy.hops.length === 0 && legacy.leaf.field === 'name');
assert(isVariableMapped(legacy), 'legacy direct field should map');

const coll = normalizeVariable({
  name: 'directors',
  kind: 'collection',
  itemKind: 'object',
  rootModel: 'Company',
  hops: [
    {
      relatedModel: 'CompanyMember',
      filters: [{ column: 'company_member_type_id', op: 'eq', value: '1' }],
    },
  ],
  leaf: null,
  itemFields: [
    { name: 'name', field: 'full_name' },
    { name: 'passport', field: 'passport_number' },
  ],
});
assert(isVariableMapped(coll), 'filtered collection should map');
assertFullyMapped([coll]);

const incomplete = normalizeVariable({
  name: 'x',
  kind: 'scalar',
  rootModel: 'Company',
  hops: [
    {
      relatedModel: 'CompanyMember',
      filters: [{ column: 'company_member_type_id', op: 'eq', value: '' }],
    },
  ],
  leaf: { field: 'name' },
});
assert(!isVariableMapped(incomplete), 'empty filter value should block mapping');

const ancestorSource = normalizeVariable({
  name: 'directorFirstName',
  kind: 'scalar',
  rootModel: 'Company',
  hops: [
    { relatedModel: 'CompanyMember', filters: [] },
    {
      relatedModel: 'CompanyPosition',
      filters: [{ column: 'company_member_type_id', op: 'eq', value: '1' }],
    },
  ],
  valueSourceHop: 0,
  leaf: { field: 'first_name' },
});
assert(ancestorSource.valueSourceHop === 0, 'valueSourceHop should round-trip');
assert(effectiveValueSourceHop(ancestorSource) === 0, 'effective source hop 0');
assert(
  modelAtValueSource(ancestorSource.rootModel, ancestorSource.hops, 0) === 'CompanyMember',
  'source model CompanyMember'
);
assert(isVariableMapped(ancestorSource), 'ancestor value source scalar should be mapped');
assertFullyMapped([ancestorSource]);

const omittedSource = normalizeVariable({
  name: 'positionTitle',
  kind: 'scalar',
  rootModel: 'Company',
  hops: [
    { relatedModel: 'CompanyMember', filters: [] },
    { relatedModel: 'CompanyPosition', filters: [] },
  ],
  leaf: { field: 'title' },
});
assert(
  omittedSource.valueSourceHop === null || omittedSource.valueSourceHop === undefined,
  'omitted valueSourceHop stays default'
);
assert(
  effectiveValueSourceHop(omittedSource) === 1,
  'omitted valueSourceHop defaults to last hop'
);
assert(isVariableMapped(omittedSource), 'omitted valueSourceHop + leaf field should map');

const invalidSource = normalizeVariable({
  name: 'badSource',
  kind: 'scalar',
  rootModel: 'Company',
  hops: [{ relatedModel: 'CompanyMember', filters: [] }],
  valueSourceHop: 5,
  leaf: { field: 'first_name' },
});
assert(effectiveValueSourceHop(invalidSource) === null, 'out-of-range source is invalid');
assert(!isVariableMapped(invalidSource), 'out-of-range valueSourceHop should block mapping');
let threw = false;
try {
  assertFullyMapped([invalidSource]);
} catch (e) {
  threw = true;
  assert(/Unmapped|valueSource|badSource/i.test(e.message), e.message);
}
assert(threw, 'assertFullyMapped should reject invalid valueSourceHop');

const collAncestor = normalizeVariable({
  name: 'directorNames',
  kind: 'collection',
  itemKind: 'object',
  rootModel: 'Company',
  hops: [
    { relatedModel: 'CompanyMember', filters: [] },
    {
      relatedModel: 'CompanyPosition',
      filters: [{ column: 'company_member_type_id', op: 'eq', value: '1' }],
    },
  ],
  valueSourceHop: 0,
  itemFields: [
    { name: 'name', field: 'first_name' },
    { name: 'last', field: 'last_name' },
  ],
});
assert(collAncestor.valueSourceHop === 0, 'collection valueSourceHop round-trip');
assert(isVariableMapped(collAncestor), 'collection with ancestor value source should map');
assertFullyMapped([collAncestor]);

const rootSource = normalizeVariable({
  name: 'companyViaMember',
  kind: 'scalar',
  rootModel: 'Company',
  hops: [{ relatedModel: 'CompanyMember', filters: [] }],
  valueSourceHop: -1,
  leaf: { field: 'name' },
});
assert(effectiveValueSourceHop(rootSource) === -1, 'root valueSourceHop -1');
assert(
  modelAtValueSource(rootSource.rootModel, rootSource.hops, -1) === 'Company',
  'root source model'
);
assert(isVariableMapped(rootSource), 'root value source should map');

console.log('smoke-path-mapping: ok');
