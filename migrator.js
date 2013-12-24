var optimist = require('optimist'),
    fields = require('fields'),
    Parse = require('parse').Parse,
    http = require('http'),
    EventEmitter = require('events').EventEmitter,
    _ = require('underscore')._,
    StackMob = require("stackmob-nodejs"),
    events = new EventEmitter(),
    argv,
    parseApp,
    schemas = null,
    SETTINGS = {
        parse: {
            appId: '',
            javascriptKey: ''
        },
        stackmob: {
            publicKey: ''
        }
    };

fields.setup({
    colors: true
});

argv = optimist.options({
            m: {
                alias: 'parse-javascript-key',
                demand: true,
                description: 'Parse javascript key'
            },
            a: {
                alias: 'parse-app-id',
                demand: true,
                description: 'Parse app id'
            },
            k: {
                alias: 'stackmob-public-key',
                demand: true,
                description: 'Stackmob public key'
            },
            r: {
                alias: 'stackmob-private-key',
                demand: true,
                description: 'Stackmob private key'
            },
            n: {
                alias: 'stackmob-version',
                demand: false,
                default: '0',
                description: 'Stackmob api version'
            },
            s: {
                alias: 'stackmob-schemas',
                demand: false,
                description: 'Comma separated Stackmob schemas to migrate, default: all. Example: user,product,order'
            },
        }).argv;

// Set arguments
SETTINGS.parse.appId = argv.a;
SETTINGS.parse.javascriptKey = argv.m;
SETTINGS.stackmob.publicKey = argv.k;
SETTINGS.stackmob.privateKey = argv.r;
SETTINGS.stackmob.version = argv.n;
SETTINGS.stackmob.selected = argv.s || null;

console.log('SETTINGS:', SETTINGS);
// Initialize Parse
Parse.initialize(SETTINGS.parse.appId, SETTINGS.parse.javascriptKey);

// Initialize Stackmob
StackMob.init({
  consumerKey: SETTINGS.stackmob.publicKey,
  consumerSecret: SETTINGS.stackmob.privateKey,
  appName: "appName",
  version: 0
});

// Get Stackmob schemas
console.log('Get Stackmob schemas...');
var options = {
        host: 'api.stackmob.com',
        port: 80,
        path: '/listapi',
        headers: {
            'Accept': 'application/vnd.stackmob+json; version=' + SETTINGS.stackmob.version,
            'X-StackMob-API-Key': SETTINGS.stackmob.publicKey
        }
    };

http.get(options, function(resp){
    var s = '';
    resp.on('data', function(chunk){
        s += chunk;
    });

    resp.on('end', function(){
        SETTINGS.stackmob.schemas = JSON.parse(s);
        events.emit('stackmob:schemas:ready', SETTINGS.stackmob.schemas);
    });
}).on("error", function(e){
  console.log("Got error: " + e.message);
});

events.on('stackmob:schemas:ready', function(allSchemas){
    var schemas = selectSchemas(allSchemas, SETTINGS.stackmob.selected),
        selected = _.keys(schemas);

    fields.select({
        title: 'The following schemas are going to be migrated to Parse, are you sure?',
        promptLabel: selected.join(', '),
        display: 'prompt',
        options: [ 'yes', 'no' ]
    }).prompt(function(err, value){
        if (err)
        {
            console.error(err);
        } else {
            if (value === 'yes')
            {
                events.emit('app:migrate', schemas);
            } else {
                console.log('Bye!');
            }
        }
    });
});

events.on('app:migrate', function(schemas){
    _.each(schemas, migrate);
});

function selectSchemas(allSchemas, selected)
{
    if (selected === null)
    {
        return allSchemas;
    }

    selected = selected.replace(/\s+/g, '').split(',');

    return _.pick(allSchemas, selected);
}

function migrate(schema)
{
    var Model = StackMob.Model.extend({ schemaName: schema.title }),
        Models = StackMob.Collection.extend({
            model: Model
        }),
        models = new Models();

    console.log('Getting "', schema.title, '" objects from Stackmob...');
    models.fetch({
        success: function(objects){
            createParseObjects(schema.title, objects.toJSON());
        },
        error: function(e){
            console.error('ERROR!', e);
        }
    });
}

function createParseObjects(className, objects)
{
    console.log('Creating Parse objects for "', className, '"');
    var Model = Parse.Object.extend(className),
        list = [];

    _.each(objects, function(object){
        // object.objectId = object[className + '_id'];
        object.updatedAt = object.lastmoddate;
        object.createdAt = object.createddate;

        object = _.omit(object, ['lastmoddate', 'createddate']);
        list.push(new Model(object));
    });

    Parse.Object.saveAll(list, {
        success: function(e){
            console.log('SUCCESS!');
        },
        error: function(collection, e){
            console.error('ERROR:', e, collection);
        }
    });
}