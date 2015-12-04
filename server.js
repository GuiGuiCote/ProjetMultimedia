var gameport = 4004,
    express = require('express'),
    http = require('http'),
    UUID = require('node-uuid'),
    app = express(),
    server = http.createServer(app),
    io = require('socket.io');

///////EXPRESS
server.listen(gameport);
console.log('\t :: Express :: Listening on port ' + gameport );

app.get('/', function(req, res) {
    res.sendfile(__dirname + '/index.html');
});

app.get( '/*' , function( req, res) {
    var file = req.params[0];
    res.sendfile(__dirname + '/' + file );
});

////////SOCKET.IO
var sio = io.listen(server);
sio.configure(function(){
    sio.set('log', 0);
    sio.set('auth', function(handS, callback){
        callback(null, true);
    });
});

sio.sockets.on('connection', function(client){
    client.userid = UUID.v1();
    client.emit('onconnected', {id: client.userid});
    console.log('\t socket.io:: player ' + client.userid + ' connected');
    client.on('disconnect', function(){
        console.log('\t socket.io:: client disconnected ' + client.userid );
    })
});


