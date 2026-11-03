const mongoose = require('mongoose');

function reply(res, status, message, data) {
  return res.status(status).json({ message, data: data === undefined ? null : data });
}

function isValidId(id) {
  return typeof id === 'string' && mongoose.Types.ObjectId.isValid(id) && /^[a-f\d]{24}$/i.test(id);
}

function parseQuery(query) {
  const out = {};
  const jsonParams = ['where', 'sort', 'select'];

  for (const key of jsonParams) {
    if (query[key] === undefined) continue;
    try {
      out[key] = JSON.parse(query[key]);
    } catch (err) {
      return { ok: false, param: key };
    }
  }

  if (query.skip !== undefined) {
    const n = Number(query.skip);
    if (!Number.isInteger(n) || n < 0) return { ok: false, param: 'skip' };
    out.skip = n;
  }

  if (query.limit !== undefined) {
    const n = Number(query.limit);
    if (!Number.isInteger(n) || n < 0) return { ok: false, param: 'limit' };
    out.limit = n;
  }

  if (query.count !== undefined) {
    out.count = query.count === 'true' || query.count === true;
  }

  return { ok: true, params: out };
}

async function runListQuery(Model, params, defaultLimit) {
  if (params.count) {
    return Model.countDocuments(params.where || {});
  }

  let q = Model.find(params.where || {});
  if (params.sort) q = q.sort(params.sort);
  if (params.select) q = q.select(params.select);
  if (params.skip) q = q.skip(params.skip);

  const limit = params.limit !== undefined ? params.limit : defaultLimit;
  if (limit) q = q.limit(limit);

  return q.exec();
}

module.exports = { reply, isValidId, parseQuery, runListQuery };