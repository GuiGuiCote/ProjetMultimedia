var gameport          = 4004
    , express         = require('express')
    , http            = require('http')
    , UUID            = require('node-uuid')
    , app             = express()
    , server          = http.createServer(app)
    , io              = require('socket.io')(server);


app.use('/', express.static(__dirname + '/index.html'));

/**
 * Liste des utilisateurs connectés
 */
var users = [];

/**
 * Historique des messages
 */
var messages = [];

/**
 * Liste des utilisateurs en train de saisir un message
 */
var typingUsers = [];



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

    /**
     * Utilisateur connecté à la socket
     */
    var loggedUser;

    /**
     * Emission d'un événement "user-login" pour chaque utilisateur connecté
     */
    for (i = 0; i < users.length; i++) {
        client.emit('user-login', users[i]);
        //console.log("toto"+ users[i].username);
    }

    /**
     * Déconnexion d'un utilisateur
     */
    client.on('disconnect', function () {
        if (loggedUser !== undefined) {
            // Broadcast d'un 'service-message'
            var serviceMessage = {
                text: 'User "' + loggedUser.username + '" disconnected',
                type: 'logout'
            };
            client.broadcast.emit('service-message', serviceMessage);
            // Suppression de la liste des connectés
            var userIndex = users.indexOf(loggedUser);
            if (userIndex !== -1) {
                users.splice(userIndex, 1);
            }
            // Ajout du message à l'historique
            messages.push(serviceMessage);
            // Emission d'un 'user-logout' contenant le user
            io.emit('user-logout', loggedUser);
            // Si jamais il était en train de saisir un texte, on l'enlève de la liste
            var typingUserIndex = typingUsers.indexOf(loggedUser);
            if (typingUserIndex !== -1) {
                typingUsers.splice(typingUserIndex, 1);
            }
        }
    });

    /**
     * Connexion d'un utilisateur via le formulaire :
     */
    /*client.on('user-login', function (user, callback) {
        // Vérification que l'utilisateur n'existe pas
        var userIndex = -1;
        var count=0;
        for (var i = 0; i < users.length; i++) {
            if (users[i].username === user.username) {
                userIndex = i;
                count=count+1;
            }
        }
        if (user !== undefined && userIndex === -1) { // S'il est bien nouveau
            // Sauvegarde de l'utilisateur et ajout à la liste des connectés

            if(users.length<2) {
                user.userid=client.userid;
                loggedUser = user;
                users.push(loggedUser);
                console.log('***********'+users[users.length-1].username+'********************' + users[users.length-1].userid);
                io.emit('user-login', loggedUser);
                callback(true);
            }else{
                users=[];
            }
        } else if (user !== undefined && userIndex !== -1) {
            if(users.length<2) {
                user.username=user.username+1;
                user.userid=client.userid;
                loggedUser = user;
                users.push(loggedUser);
                console.log('**************'+users[users.length-1].username+'*****************' + users[users.length-1].userid);
                io.emit('user-login', loggedUser);
                callback(true);
            }else{
                users=[];
            }

        }else{
            callback(false);
        }
    });*/




    //Génération de l'ID unique
    client.userid = UUID();

    client.on('user-login', function (user, callback) {
        // Vérification que l'utilisateur n'existe pas
        var userIndex = -1;
        var count=0;
        for (var i = 0; i < users.length; i++) {
            if (users[i].username === user.username) {
                userIndex = i;
                count=count+1;
            }
        }
        if (user !== undefined && userIndex === -1) { // S'il est bien nouveau
            // Sauvegarde de l'utilisateur et ajout à la liste des connectés

            if(users.length<2) {
                loggedUser = user;
                users.push(loggedUser);

                io.emit('user-login', loggedUser);

                client.username=user.username;
                //Envoie du message au client contenant sont ID
                client.emit('onconnected', { id: client.userid } );

                //On cherche une partie pour le joueur qui vient de se connecter
                gameServer.findGame(client);

                //Affichage dans la console de l'ID du client qui viens de se connecter
                console.log('\t socket.io:: player ' + client.userid + ' connected ');

                //On veut gérer les messages du client, ils arrivent d'abord ici pui on les envoi sur le serveur de jeu
                client.on('message', function(m) {
                    gameServer.onMessage(client, m);
                });
                callback(true);
            }else{
                users=[];
            }
        } else if (user !== undefined && userIndex !== -1) {
            if(users.length<2) {
                user.username=user.username+count;
                loggedUser = user;
                users.push(loggedUser);
                //console.log('**************'+users[users.length-1].username+'*****************' + users[users.length-1].userid);
                io.emit('user-login', loggedUser);

                client.username=user.username;
                //Envoie du message au client contenant sont ID
                client.emit('onconnected', { id: client.userid } );

                //On cherche une partie pour le joueur qui vient de se connecter
                gameServer.findGame(client);

                //Affichage dans la console de l'ID du client qui viens de se connecter
                console.log('\t socket.io:: player ' + client.userid + ' connected ');

                //On veut gérer les messages du client, ils arrivent d'abord ici pui on les envoi sur le serveur de jeu
                client.on('message', function(m) {
                    gameServer.onMessage(client, m);
                });
                callback(true);
            }else{
                users=[];
            }

        }else{
            callback(false);
        }

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
