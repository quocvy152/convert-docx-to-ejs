'use strict';

const config = require('../config');

function decodeJwtPayload(token) {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
  return JSON.parse(payload);
}

/**
 * MVP auth:
 * 1) X-Template-Builder-Key matching TEMPLATE_BUILDER_API_KEYS, or
 * 2) Authorization: Bearer <jwt> when JWT_SECRET is set (signature not fully verified in MVP —
 *    plug CRM verify later; we only check permission claim presence for wiring).
 */
function requireTemplateBuilderAccess(req, res, next) {
  try {
    const apiKey = req.header('X-Template-Builder-Key');
    if (apiKey && config.apiKeys.includes(apiKey)) {
      req.builderUser = { id: 'api-key', source: 'api_key' };
      return next();
    }

    const auth = req.header('Authorization') || '';
    if (auth.startsWith('Bearer ') && config.jwtSecret) {
      const token = auth.slice(7).trim();
      const payload = decodeJwtPayload(token);
      const permissions = payload?.Permissions || payload?.permissions || [];
      const values = permissions.map((p) => (typeof p === 'string' ? p : p?.value)).filter(Boolean);
      if (values.includes(config.requiredPermission) || values.length === 0) {
        // length===0: allow while CRM JWT shape is wired; tighten after integration
        req.builderUser = {
          id: payload?.id || payload?.user_id || payload?.sub || 'jwt-user',
          source: 'jwt',
          permissions: values,
        };
        return next();
      }
      return res.status(403).json({ error: 'Missing template config permission' });
    }

    return res.status(401).json({
      error: 'Unauthorized',
      hint: 'Send X-Template-Builder-Key or Authorization Bearer token',
    });
  } catch (error) {
    return res.status(401).json({ error: 'Invalid auth', message: error.message });
  }
}

module.exports = { requireTemplateBuilderAccess };
