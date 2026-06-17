const jwt = require('jsonwebtoken');

const authenticateToken = (req, res, next) => {
    const headerValue = req.headers.authorization || '';
    const [scheme, token] = headerValue.split(' ');

    if (scheme !== 'Bearer' || !token) {
        return res.status(401).json({ message: 'Missing or invalid Authorization header.' });
    }

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
        return res.status(500).json({ message: 'JWT is not configured on the server.' });
    }

    try {
        const decoded = jwt.verify(token, jwtSecret);
        req.user = decoded;
        return next();
    } catch (_error) {
        return res.status(401).json({ message: 'Invalid or expired token.' });
    }
};

const optionallyAuthenticateToken = (req, res, next) => {
    const headerValue = req.headers.authorization || '';

    if (!headerValue) {
        return next();
    }

    const [scheme, token] = headerValue.split(' ');

    if (scheme !== 'Bearer' || !token) {
        return res.status(401).json({ message: 'Missing or invalid Authorization header.' });
    }

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
        return res.status(500).json({ message: 'JWT is not configured on the server.' });
    }

    try {
        req.user = jwt.verify(token, jwtSecret);
        return next();
    } catch (_error) {
        return res.status(401).json({ message: 'Invalid or expired token.' });
    }
};

const requireRole = (...allowedRoles) => (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
        return res.status(403).json({ message: 'Insufficient permissions.' });
    }
    return next();
};

module.exports = {
    authenticateToken,
    optionallyAuthenticateToken,
    requireRole
};
