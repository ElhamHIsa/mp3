const express = require('express');
const User = require('../models/user');
const Task = require('../models/task');
const { reply, isValidId, parseQuery, runListQuery } = require('./helpers');

const router = express.Router();

// Validates a task body and resolves its assigned user. Returns { status, message }
// on failure, or { ok: true, fields, user } on success.
async function validateTaskBody(body) {
  const { name, deadline } = body;

  if (typeof name !== 'string' || name.trim() === '') {
    return { status: 400, message: 'A task must have a name.' };
  }
  if (deadline === undefined || deadline === null || deadline === '') {
    return { status: 400, message: 'A task must have a deadline.' };
  }
  const deadlineDate = new Date(deadline);
  if (Number.isNaN(deadlineDate.getTime())) {
    return { status: 400, message: 'The deadline is not a valid date.' };
  }

  if (body.description !== undefined && typeof body.description !== 'string') {
    return { status: 400, message: 'description must be text.' };
  }
  if (body.completed !== undefined && typeof body.completed !== 'boolean') {
    return { status: 400, message: 'completed must be true or false.' };
  }
  if (body.assignedUser !== undefined && typeof body.assignedUser !== 'string') {
    return { status: 400, message: 'assignedUser must be a user id.' };
  }
  if (body.assignedUserName !== undefined && typeof body.assignedUserName !== 'string') {
    return { status: 400, message: 'assignedUserName must be text.' };
  }

  const assignedUser = body.assignedUser || '';
  let assignedUserName = 'unassigned';
  let user = null;

  if (assignedUser !== '') {
    if (!isValidId(assignedUser)) {
      return { status: 400, message: `"${assignedUser}" is not a valid user id.` };
    }
    user = await User.findById(assignedUser);
    if (!user) {
      return { status: 404, message: `User ${assignedUser} does not exist.` };
    }
    if (body.assignedUserName !== undefined && body.assignedUserName !== '' && body.assignedUserName !== user.name) {
      return { status: 400, message: 'assignedUserName does not match the assigned user.' };
    }
    assignedUserName = user.name;
  }

  return {
    ok: true,
    user,
    fields: {
      name,
      description: body.description === undefined ? '' : body.description,
      deadline: deadlineDate,
      completed: body.completed === undefined ? false : body.completed,
      assignedUser,
      assignedUserName,
    },
  };
}

router.get('/', async (req, res) => {
  const parsed = parseQuery(req.query);
  if (!parsed.ok) return reply(res, 400, `The ${parsed.param} parameter is not valid.`);

  try {
    const data = await runListQuery(Task, parsed.params, 100);
    return reply(res, 200, 'OK', data);
  } catch (err) {
    return reply(res, 400, 'The query could not be processed.');
  }
});

router.post('/', async (req, res) => {
  try {
    const check = await validateTaskBody(req.body);
    if (!check.ok) return reply(res, check.status, check.message);

    const task = await Task.create(check.fields);

    if (check.user && !task.completed) {
      await User.updateOne({ _id: check.user._id }, { $addToSet: { pendingTasks: task._id.toString() } });
    }

    return reply(res, 201, 'Task created.', task);
  } catch (err) {
    return reply(res, 500, 'Something went wrong while creating the task.');
  }
});

router.get('/:id', async (req, res) => {
  if (!isValidId(req.params.id)) return reply(res, 404, 'Task not found.');

  const parsed = parseQuery({ select: req.query.select });
  if (!parsed.ok) return reply(res, 400, 'The select parameter is not valid.');

  try {
    let q = Task.findById(req.params.id);
    if (parsed.params.select) q = q.select(parsed.params.select);
    const task = await q.exec();
    if (!task) return reply(res, 404, 'Task not found.');
    return reply(res, 200, 'OK', task);
  } catch (err) {
    return reply(res, 500, 'Something went wrong while fetching the task.');
  }
});

router.put('/:id', async (req, res) => {
  if (!isValidId(req.params.id)) return reply(res, 404, 'Task not found.');

  try {
    const task = await Task.findById(req.params.id);
    if (!task) return reply(res, 404, 'Task not found.');

    const check = await validateTaskBody(req.body);
    if (!check.ok) return reply(res, check.status, check.message);

    const previousUser = task.assignedUser;
    const taskId = task._id.toString();

    Object.assign(task, check.fields);
    await task.save();

    if (previousUser && previousUser !== task.assignedUser) {
      await User.updateOne({ _id: previousUser }, { $pull: { pendingTasks: taskId } });
    }

    if (task.assignedUser) {
      if (task.completed) {
        await User.updateOne({ _id: task.assignedUser }, { $pull: { pendingTasks: taskId } });
      } else {
        await User.updateOne({ _id: task.assignedUser }, { $addToSet: { pendingTasks: taskId } });
      }
    }

    return reply(res, 200, 'Task updated.', task);
  } catch (err) {
    return reply(res, 500, 'Something went wrong while updating the task.');
  }
});

router.delete('/:id', async (req, res) => {
  if (!isValidId(req.params.id)) return reply(res, 404, 'Task not found.');

  try {
    const task = await Task.findById(req.params.id);
    if (!task) return reply(res, 404, 'Task not found.');

    if (task.assignedUser) {
      await User.updateOne({ _id: task.assignedUser }, { $pull: { pendingTasks: task._id.toString() } });
    }
    await task.deleteOne();

    return reply(res, 200, 'Task deleted.', task);
  } catch (err) {
    return reply(res, 500, 'Something went wrong while deleting the task.');
  }
});

module.exports = router;