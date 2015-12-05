var gameport = 4004,
    express = require('express'),
    http = require('http'),
    UUID = require('node-uuid'),
    app = express(),
    server = http.createServer(app),
    io = require('socket.io')(server);

///////EXPRESS
server.listen(gameport);
console.log('\t :: Express :: Listening on port ' + gameport );

app.get('/', function(req, res) {
    res.sendFile(__dirname + '/index.html');
});

app.get( '/*' , function( req, res) {
    var file = req.params[0];
    res.sendFile(__dirname + '/' + file );
});

////////SOCKET.IO
io.use(function(socket, next){
    console.log('Function use called');
    var handShakeData = socket.request;
    next();
});

io.sockets.on('connection', function(player){
    console.log('Sockets called');
    player.userid = UUID.v1();
    player.emit('onconnected', {id: player.userid});
    console.log('\t socket.io:: player ' + player.userid + ' connected');
    player.on('disconnect', function(){
        console.log('\t socket.io:: player disconnected ' + player.userid );
    })
});


