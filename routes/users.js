const express = require('express');
const User = require('../models/user');
const Task = require('../models/task');
const { reply, isValidId, parseQuery, runListQuery } = require('./helpers');

const router = express.Router();

// Validates a user body and the tasks it references. Returns { status, message }
// on failure, or { ok: true, tasks } with the resolved pending tasks on success.
async function validateUserBody(body, excludeUserId) {
  const { name, email } = body;

  if (typeof name !== 'string' || name.trim() === '') {
    return { status: 400, message: 'A user must have a name.' };
  }
  if (typeof email !== 'string' || email.trim() === '') {
    return { status: 400, message: 'A user must have an email.' };
  }

  let pendingTasks = body.pendingTasks === undefined ? [] : body.pendingTasks;
  if (!Array.isArray(pendingTasks) || !pendingTasks.every((t) => typeof t === 'string')) {
    return { status: 400, message: 'pendingTasks must be a list of task ids.' };
  }
  pendingTasks = [...new Set(pendingTasks)];

  for (const id of pendingTasks) {
    if (!isValidId(id)) {
      return { status: 400, message: `"${id}" is not a valid task id.` };
    }
  }

  const emailQuery = { email };
  if (excludeUserId) emailQuery._id = { $ne: excludeUserId };
  const existing = await User.findOne(emailQuery);
  if (existing) {
    return { status: 400, message: 'A user with that email already exists.' };
  }

  const tasks = await Task.find({ _id: { $in: pendingTasks } });
  if (tasks.length !== pendingTasks.length) {
    const found = new Set(tasks.map((t) => t._id.toString()));
    const missing = pendingTasks.find((id) => !found.has(id));
    return { status: 404, message: `Task ${missing} does not exist.` };
  }

  const completed = tasks.find((t) => t.completed);
  if (completed) {
    return { status: 400, message: `Task ${completed._id} is completed and cannot be pending.` };
  }

  return { ok: true, pendingTasks, tasks };
}

// Assigns a list of task ids to a user, pulling them from any other user's list.
async function assignTasksTo(user, taskIds) {
  if (taskIds.length === 0) return;
  await User.updateMany(
    { _id: { $ne: user._id }, pendingTasks: { $in: taskIds } },
    { $pull: { pendingTasks: { $in: taskIds } } }
  );
  await Task.updateMany(
    { _id: { $in: taskIds } },
    { $set: { assignedUser: user._id.toString(), assignedUserName: user.name } }
  );
}

router.get('/', async (req, res) => {
  const parsed = parseQuery(req.query);
  if (!parsed.ok) return reply(res, 400, `The ${parsed.param} parameter is not valid.`);

  try {
    const data = await runListQuery(User, parsed.params, 0);
    return reply(res, 200, 'OK', data);
  } catch (err) {
    return reply(res, 400, 'The query could not be processed.');
  }
});

router.post('/', async (req, res) => {
  try {
    const check = await validateUserBody(req.body);
    if (!check.ok) return reply(res, check.status, check.message);

    const user = await User.create({
      name: req.body.name,
      email: req.body.email,
      pendingTasks: check.pendingTasks,
    });

    await assignTasksTo(user, check.pendingTasks);
    return reply(res, 201, 'User created.', user);
  } catch (err) {
    return reply(res, 500, 'Something went wrong while creating the user.');
  }
});

router.get('/:id', async (req, res) => {
  if (!isValidId(req.params.id)) return reply(res, 404, 'User not found.');

  const parsed = parseQuery({ select: req.query.select });
  if (!parsed.ok) return reply(res, 400, 'The select parameter is not valid.');

  try {
    let q = User.findById(req.params.id);
    if (parsed.params.select) q = q.select(parsed.params.select);
    const user = await q.exec();
    if (!user) return reply(res, 404, 'User not found.');
    return reply(res, 200, 'OK', user);
  } catch (err) {
    return reply(res, 500, 'Something went wrong while fetching the user.');
  }
});

router.put('/:id', async (req, res) => {
  if (!isValidId(req.params.id)) return reply(res, 404, 'User not found.');

  try {
    const user = await User.findById(req.params.id);
    if (!user) return reply(res, 404, 'User not found.');

    const check = await validateUserBody(req.body, user._id);
    if (!check.ok) return reply(res, check.status, check.message);

    const oldIds = user.pendingTasks;
    const newIds = check.pendingTasks;
    const removed = oldIds.filter((id) => !newIds.includes(id));
    const added = newIds.filter((id) => !oldIds.includes(id));
    const nameChanged = user.name !== req.body.name;

    user.name = req.body.name;
    user.email = req.body.email;
    user.pendingTasks = newIds;
    await user.save();

    if (removed.length) {
      await Task.updateMany(
        { _id: { $in: removed } },
        { $set: { assignedUser: '', assignedUserName: 'unassigned' } }
      );
    }

    await assignTasksTo(user, added);

    if (nameChanged) {
      await Task.updateMany(
        { assignedUser: user._id.toString() },
        { $set: { assignedUserName: user.name } }
      );
    }

    return reply(res, 200, 'User updated.', user);
  } catch (err) {
    return reply(res, 500, 'Something went wrong while updating the user.');
  }
});

router.delete('/:id', async (req, res) => {
  if (!isValidId(req.params.id)) return reply(res, 404, 'User not found.');

  try {
    const user = await User.findById(req.params.id);
    if (!user) return reply(res, 404, 'User not found.');

    await Task.updateMany(
      { assignedUser: user._id.toString() },
      { $set: { assignedUser: '', assignedUserName: 'unassigned' } }
    );
    await user.deleteOne();

    return res.status(204).send();
  } catch (err) {
    return reply(res, 500, 'Something went wrong while deleting the user.');
  }
});

module.exports = router;