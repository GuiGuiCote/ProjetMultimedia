var gameport          = 4004
    , express         = require('express')
    , http            = require('http')
    , UUID            = require('node-uuid')
    , app             = express()
    , server          = http.createServer(app)
    , io              = require('socket.io')(server);

//////////////////////////////////////////
////                                  ////
////            EXPRESS               ////
////                                  ////
//////////////////////////////////////////

    //On écoute le port défini
    server.listen(gameport)

    //Affichage dans la console du succès
    console.log('\t :: Express :: Listening on port ' + gameport );

    //Par défaut on renvoi tout chemin / vers /index.html
    app.get( '/', function(req, res){
        console.log('trying to load %s', __dirname + '/index.html');
        res.sendFile( '/index.html' , { root:__dirname });
    });

    //Ici on gère les requète sur tout autre fichier
    app.get( '/*' , function(req, res) {
        var file = req.params[0];
        res.sendFile( __dirname + '/' + file );
    });


//////////////////////////////////////////
////                                  ////
////            SOCKET.IO             ////
////                                  ////
//////////////////////////////////////////

//Configuration Socket.io
io.use(function(socket, next){
    var handShakeData = socket.request;
    next();
});

//Inclusion du code serveur qui va gérer les connections, création & supression de parties et
//la connection & deconnection des parties.
gameServer = require('./server.js');


//Dès qu'un client se connecte au serveur, on appelle cette fonction qui va générer une ID unqiue pour el mantient
//de la liste des joueur ainsi que chercher un partie pour lui.
io.sockets.on('connection', function (client) {
        
    //Génération de l'ID unique
    client.userid = UUID();

    //Envoie du message au client contenant sont ID
    client.emit('onconnected', { id: client.userid } );

    //On cherche une partie pour le joueur qui vient de se connecter
    gameServer.findGame(client);

    //Affichage dans la console de l'ID du client qui viens de se connecter
    console.log('\t socket.io:: player ' + client.userid + ' connected');

    //On veut gérer les messages du client, ils arrivent d'abord ici pui on les envoi sur le serveur de jeu
    client.on('message', function(m) {
        gameServer.onMessage(client, m);
    });

    //On gère la deconnection d'un joueur pour que le serveur réagisse en conséquence
    //Exemple : notifier les autres joueurs qu'il est déconnecté ou si il est le dernier on supprimer la partie.
    client.on('disconnect', function () {

        //Affichage dans la console de l'ID du client qui vient de se deconnecter
        console.log('\t socket.io:: client disconnected ' + client.userid + ' ' + client.game.idDeLaPartie);

        //Si ce client est dans une partie
        if(client.game && client.game.idDeLaPartie) {
            //On termine la partie
            gameServer.endGame(client.game.idDeLaPartie, client.userid);
        }
    });
});
