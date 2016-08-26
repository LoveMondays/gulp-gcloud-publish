'use strict';

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

function _objectWithoutProperties(obj, keys) { var target = {}; for (var i in obj) { if (keys.indexOf(i) >= 0) continue; if (!Object.prototype.hasOwnProperty.call(obj, i)) continue; target[i] = obj[i]; } return target; }

var gcloud = require('gcloud');
var gutil = require('gulp-util');
var mime = require('mime');
var through = require('through2');
var assert = require('assert');

var PLUGIN_NAME = 'gulp-gcloud';
var PluginError = gutil.PluginError;

/**
 * Get the file metadata
 *
 * @private
 * @param {File} file
 */
function getMetadata(file) {
  var extraMetadata = arguments.length <= 1 || arguments[1] === undefined ? {} : arguments[1];

  var meta = _extends({}, extraMetadata, {
    contentType: mime.lookup(file.path.replace(/\.gz$/, ''))
  });

  // Check to see if it has a gz (Gzip) extension
  if (file.extname == '.gz') {
    meta.contentEncoding = 'gzip';
  };

  return meta;
}

/**
 * Normalize the path to save the file on GCS
 *
 * @param base - Base path
 * @param file - File to save
 */
function normalizePath(_base, file) {
  var _relative = file.path.replace(file.base, '');
  var base = _base;

  // ensure there is a tailing slash in the base path
  if (base && !/\/$/.test(base)) {
    base += '/';
  }

  // ensure the is no starting slash
  if (base && /^\//.test(base)) {
    base = base.replace(/^\//, '');
  }

  base = base || '';
  return base + _relative;
}

/**
 * Log the file succesfully uploaded
 */
function logSuccess(gPath) {
  gutil.log('Uploaded', gutil.colors.cyan(gPath));
}

/**
 * Asserts configuration and wraps in PluginError
 */
function assertConfiguration(options) {
  try {
    assert(options, 'Missing configuration object');
    assert(options.bucket, 'Bucket name must be specified via `bucket`');
    assert(options.keyFilename || options.credentials, 'credentials must be specified');
    assert(options.projectId, 'projectId must be specified');
  } catch (e) {
    throw new PluginError(PLUGIN_NAME, e, { showStack: true });
  }
}

/**
 * Upload a file stream to Google Cloud Storage
 *
 * @param {Object}  options
 * @param {String}  options.bucket      - Name of the bucket we want to upload the file into
 * @param {String}  options.keyFilename - Full path to the KeyFile JSON
 * @param {String}  options.credentials - Object with gcloud credentials, specify either that, or keyFilename
 * @param {String}  options.projectId   - Project id
 * @param {String}  [options.base='/']  - Base path for saving the file
 * @param {Boolean} [options.public]    - Set the file as public
 * @param {String}  [options.cacheControl] - Sets cache control for a given file
 * @param {Function} [options.transformPath] - transforms file path
 */
function gPublish(options) {
  // assert that we have correct configuration
  assertConfiguration(options);

  // files
  var base = options.base;
  var bucketName = options.bucket;
  var pub = options.public;
  var extraMetadata = options.metadata;
  var transformPath = options.transformPath;

  var gcloudOptions = _objectWithoutProperties(options, ['base', 'bucket', 'public', 'metadata', 'transformPath']);

  var storage = gcloud.storage(gcloudOptions);
  var bucket = storage.bucket(bucketName);
  var predefinedAcl = pub ? 'publicRead' : null;

  // Monkey-patch Gcloud File prototype
  if (predefinedAcl) {
    (function () {
      var File = require('gcloud/lib/storage/file');
      var util = require('gcloud/lib/common/util');
      var format = require('string-format-obj');
      var is = require('is');
      var STORAGE_UPLOAD_BASE_URL = 'https://www.googleapis.com/upload/storage/v1/b';
      File.prototype.startSimpleUpload_ = function patchedSimpleUpload(dup, metadata) {
        var self = this;
        var reqOpts = {
          qs: {
            name: self.name,
            predefinedAcl: predefinedAcl
          },
          uri: format('{uploadBaseUrl}/{bucket}/o', {
            uploadBaseUrl: STORAGE_UPLOAD_BASE_URL,
            bucket: self.bucket.name
          })
        };

        if (is.defined(this.generation)) {
          reqOpts.qs.ifGenerationMatch = this.generation;
        }

        util.makeWritableStream(dup, {
          metadata: metadata,
          makeAuthenticatedRequest: this.storage.makeAuthenticatedRequest,
          request: reqOpts
        }, function (data) {
          self.metadata = data;
          dup.emit('complete');
        });
      };
    })();
  }

  return through.obj(function (file, enc, done) {
    /* istanbul ignore next */
    if (file.isNull()) {
      return done(null, file);
    }

    var metadata = getMetadata(file, extraMetadata);

    // Authenticate on Google Cloud Storage
    var gcPath = transformPath ? transformPath(file) : normalizePath(base, file);
    var gcFile = bucket.file(gcPath);
    var stream = gcFile.createWriteStream({ metadata: metadata, resumable: false });

    return file.pipe(stream).on('error', done).on('finish', function () {
      logSuccess(gcPath);
      return done(null, file);
    });
  });
}

module.exports = gPublish;