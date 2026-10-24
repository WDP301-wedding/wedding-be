/** Exact entity types emitted by venue-catalog writers (including version mutations). */
export const catalogResources = {
  'restaurant-profile': ['/catalog/restaurant'],
  'restaurant-shift': ['/catalog/restaurant', '/catalog/shifts'],
  hall: ['/catalog/halls'],
  dish: ['/catalog/dishes', '/catalog/menus'],
  'dish-version': ['/catalog/dishes', '/catalog/menus'],
  'menu-package': ['/catalog/menus'],
  'menu-package-version': ['/catalog/menus'],
  'timeline-template': ['/catalog/timeline-templates'],
  'timeline-template-version': ['/catalog/timeline-templates'],
  'layout-template': ['/catalog/layout-templates'],
  'layout-template-version': ['/catalog/layout-templates'],
  'layout-table-identity': ['/catalog/layout-templates'],
  'catalog-media-asset': ['/catalog'],
  'print-offering': ['/catalog/print-offerings'],
  'restaurant-service': ['/catalog/services'],
} as const;

export function resourcesForCatalogEntity(entityType: string): readonly string[] | null {
  return Object.hasOwn(catalogResources, entityType)
    ? catalogResources[entityType as keyof typeof catalogResources]
    : null;
}
