/* Shared validation for public data, backups and edits. */
(function (root) {
  'use strict';
  const price = value => {
    const text = String(value).trim();
    if (!/^\$?\s*(?:\d+|\d{1,3}(?:\.\d{3})+)$/.test(text)) throw new Error('Ingresa un precio entero en pesos, por ejemplo 3000 o $3.000.');
    const amount = Number(text.replace(/[$\s.]/g, ''));
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 10000000) throw new Error('El precio debe ser mayor que cero y menor o igual a $10.000.000.');
    return amount;
  };
  const format = value => '$' + price(value).toLocaleString('es-CL');
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function normalize(input) {
    const legacy = Array.isArray(input);
    const source = legacy ? input : input?.categorias;
    if (!Array.isArray(source) || !source.length || source.length > 100) throw new Error('El archivo no contiene un menú válido.');
    const categoryIds = new Set(), itemIds = new Set();
    let count = 0;
    const categorias = source.map((cat, ci) => {
      const id = String(cat.id || 'categoria-' + ci);
      if (!/^[a-zA-Z0-9_-]+$/.test(id) || categoryIds.has(id)) throw new Error('Categoría inválida o duplicada.');
      categoryIds.add(id);
      const nombre = String(legacy ? cat.name : cat.nombre).trim();
      const subs = legacy ? cat.subcategories : cat.subcats;
      if (!nombre || nombre === 'undefined' || !Array.isArray(subs)) throw new Error('Categoría incompleta.');
      return {id, nombre, icon: String((legacy ? cat.emoji : cat.icon) || ''), subcats: subs.map((sub, si) => {
        const items = sub.items == null ? [] : sub.items;
        if (!Array.isArray(items)) throw new Error('Lista de productos inválida.');
        return {...(sub.tipo === 'agregados' ? {tipo:'agregados'} : {}), label: (legacy ? sub.name : sub.label) || null, items: items.map((item, ii) => {
          const id = String(item.id || `legacy-${ci}-${si}-${ii}`);
          if (itemIds.has(id)) throw new Error('Hay productos con identificadores duplicados.');
          itemIds.add(id); count++;
          const nombre = String((legacy ? item.name : item.nombre) || '').trim();
          if (!nombre || nombre.length > 180) throw new Error('Cada producto necesita un nombre de hasta 180 caracteres.');
          const result = {id, nombre, precio: format(legacy ? item.price : item.precio), top: item.top === true};
          if (item.desc) result.desc = String(item.desc).slice(0, 500);
          return result;
        })};
      })};
    });
    if (!count || count > 2000) throw new Error('El menú debe tener entre 1 y 2.000 productos.');
    return {categorias};
  }
  root.MenuCore = {price, format, escape, normalize};
})(typeof window === 'undefined' ? globalThis : window);
