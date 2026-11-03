module.exports = function (app, router) {
  app.use('/api/users', require('./users'));
  app.use('/api/tasks', require('./tasks'));

  app.get('/api', function (req, res) {
    res.status(200).json({ message: 'Llama.io API', data: null });
  });

  app.use(function (req, res) {
    res.status(404).json({ message: 'That endpoint does not exist.', data: null });
  });
};