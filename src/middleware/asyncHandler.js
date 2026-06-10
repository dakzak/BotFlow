/**
 * Express 4 ne capte pas les rejets de promesses dans les handlers async :
 * ce wrapper les route vers le middleware d'erreurs centralisé (src/app.js).
 */
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { asyncHandler };
