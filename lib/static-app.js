var _ = require('underscore')
  , async = require('async')
  , browserify = require('browserify')
  , cleanCSS = require('clean-css')
  , cluster = require('cluster')
  , connect = require('connect')
  , fs = require('fs')
  , jade = require('jade')
  , nib = require('nib')
  , path = require('path')
  , stylus = require('stylus')
  , url = require('url')

function endsWith(big, little) {
  var bLen = big.length
    , lLen = little.length
  if (bLen < lLen) return false
  if (bLen === lLen) return big === little
  return big.substring(bLen - lLen, bLen) === little
}

var StaticApp = module.exports = function(opts) {
  if (!(this instanceof StaticApp)) return new StaticApp(opts)
  this.opts = _.defaults(opts || {}, StaticApp.defaultOptions)

  this.browserify = browserify({ require: this.getPathOption('script') })
  if (this.opts.minify) this.browserify.register('post', require('uglify-js'))
}

StaticApp.prototype.bind = function(server) {
  server.use(connect.logger('dev'))
  server.use(this.handle.bind(this))
  server.use(connect.static(this.getPathOption('public')))
  return server
}

StaticApp.prototype.handle = function(req, res, next) {
  if (this.opts.path !== url.parse(req.url).pathname) return next()
  this.render(function(er, page) {
    if (er) return next(er)
    res.writeHead(200, {
      'Content-Type': 'text/html',
      'Content-Length': page.length,
    })
    res.end(page)
  })
}

StaticApp.prototype.getPathOption = function(name) {
  return path.join(this.opts.root, this.opts[name])
}

StaticApp.prototype.loadScript = function(cb) {
  process.nextTick(cb.bind(null, null, this.browserify.bundle()))
}

StaticApp.prototype.loadStyle = function(cb) {
  var that = this
    , filename = this.getPathOption('style')
  fs.readFile(filename, 'utf8', function(er, css) {
    if (er) return cb(er)

    if (endsWith(filename, '.styl')) {
      return stylus(css)
        .use(nib())
        .render(function(er, css) {
          if (er) return cb(er)
          if (that.opts.minify) css = cleanCSS.process(css)
          cb(null, css)
        })
    }

    cb(null, css)
  })
}

StaticApp.prototype.loadIndex = function(cb) {
  var filename = this.getPathOption('index')
  fs.readFile(filename, 'utf8', function(er, content) {
    if (er) return cb(er)

    if (endsWith(filename, '.jade')) {
      content = jade.compile(content, {
        filename: filename,
        compileDebug: true,
      })()
    }

    cb(null, content)
  })
}

StaticApp.prototype.getScriptRequire = function() {
  return ';require("./' + path.basename(this.opts.script) + '")'
}

StaticApp.prototype.render = function(cb) {
  if (this.cachedPage)
    return process.nextTick(cb.bind(null, null, this.cachedPage))

  var that = this
  async.parallel(
    [
      this.loadScript.bind(this),
      this.loadStyle.bind(this),
      this.loadIndex.bind(this),
    ],
    function(er, res) {
      if (er) return cb(er)
      var script = '<script>' + res[0] + that.getScriptRequire() + '</script>'
        , style = '<style>' + res[1] + '</style>'
        , page = res[2]
            .replace('</head>', style + '</head>')
            .replace('</body>', script + '</body>')
      that.cachedPage = page
      cb(null, page)
    }
  )
}

StaticApp.defaultOptions = {
  host: '0.0.0.0',
  port: 3000,
  index: 'views/index.jade',
  script: 'public/script.js',
  style: 'public/style.styl',
  public: 'public',
  root: '',
  minify: false,
  path: '/',
}

StaticApp.reloadExt = [
  '.css',
  '.haml',
  '.html',
  '.jade',
  '.js',
  '.styl',
]

StaticApp.main = function() {
  var argv = require('optimist')
              .usage('Fast static apps.')
              .boolean(['minify', 'out'])
              .demand('root')
              .argv

  var app = StaticApp(argv)
  if (argv.out) {
    app.render(function(er, page) {
      if (er) throw er
      process.stdout.write(page)
    })
  } else {
    cluster(app.bind(connect.createServer()))
      .use(cluster.pidfiles(path.join('/tmp', path.basename(app.opts.root))))
      .use(cluster.cli())
      .use(cluster.reload(app.opts.root, { extensions: StaticApp.reloadExt }))
      .set('workers', 1)
      .listen(app.opts.port, app.opts.host)
  }
}
