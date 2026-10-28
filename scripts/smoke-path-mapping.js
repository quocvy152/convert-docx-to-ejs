'use strict';

const {
  normalizeVariable,
  isVariableMapped,
  assertFullyMapped,
  resolveHopModels,
} = require('../src/services/pathMappingService');
const { getPathRecipe } = require('../src/config/pathRecipes');

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

const recipe = getPathRecipe('director-country-name');
const mapped = normalizeVariable({ name: 'directorCountry', kind: 'scalar', ...recipe });
assert(isVariableMapped(mapped), 'recipe scalar should be mapped');
assertFullyMapped([mapped]);

const resolved = resolveHopModels(mapped.rootModel, mapped.hops);
assert(resolved.ok, resolved.error);
assert(resolved.leafModel === 'Country', `expected Country, got ${resolved.leafModel}`);

const legacy = normalizeVariable({ name: 'companyName', kind: 'scalar', model: 'Company', field: 'name' });
assert(legacy.rootModel === 'Company' && legacy.hops.length === 0 && legacy.leaf.field === 'name');
assert(isVariableMapped(legacy), 'legacy direct field should map');

const collRecipe = getPathRecipe('directors-members');
const coll = normalizeVariable({
  name: 'directors',
  kind: 'collection',
  itemKind: 'object',
  itemFields: [
    { name: 'name', field: 'full_name' },
    { name: 'passport', field: 'passport_number' },
  ],
  ...collRecipe,
});
assert(isVariableMapped(coll), 'filtered collection recipe should map');
assertFullyMapped([coll]);

const incomplete = normalizeVariable({
  name: 'x',
  kind: 'scalar',
  rootModel: 'Company',
  hops: [{ association: 'members', filters: [{ column: 'company_member_type_id', op: 'eq', value: '' }] }],
  leaf: { field: 'name' },
});
assert(!isVariableMapped(incomplete), 'empty filter value should block mapping');

console.log('smoke-path-mapping: ok');
