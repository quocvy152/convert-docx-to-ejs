'use strict';

/**
 * Built-in path recipes for Variable mapping (local catalog, not user-editable yet).
 * Applied onto a variable of matching kind; itemFields stay from the DOCX.
 */
const PATH_RECIPES = [
  {
    id: 'director-country-name',
    label: 'Director → country name',
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
  },
  {
    id: 'directors-members',
    label: 'Directors (filtered members)',
    kind: 'collection',
    rootModel: 'Company',
    hops: [
      {
        association: 'members',
        filters: [{ column: 'company_member_type_id', op: 'eq', value: '1' }],
      },
    ],
    leaf: null,
  },
];

function listPathRecipes(kind) {
  const all = PATH_RECIPES.map((r) => ({
    id: r.id,
    label: r.label,
    kind: r.kind,
    rootModel: r.rootModel,
    hops: r.hops.map((h) => ({
      association: h.association,
      filters: (h.filters || []).map((f) => ({ ...f })),
    })),
    leaf: r.leaf ? { field: r.leaf.field } : null,
  }));
  if (!kind) return all;
  return all.filter((r) => r.kind === kind);
}

function getPathRecipe(id) {
  return listPathRecipes().find((r) => r.id === id) || null;
}

module.exports = {
  PATH_RECIPES,
  listPathRecipes,
  getPathRecipe,
};
