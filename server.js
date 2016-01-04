var gameServer = module.exports = { games : {}, game_count:0 },
    UUID        = require('node-uuid'),
    verbose     = true;

//On partage du code entre le client et le serveur das le fichier gameShared.js,
//Si cette variable est défini on exécutera certaines portions de code ou pas dans gameShared.js
global.window = global.document = global;

//Inclusion du code partagé entre le client et le serveur
require('./shared.js');

//Simple fonction pour loguer dans la console
gameServer.log = function() {
    if(verbose) console.log.apply(this,arguments);
};

//timer local
gameServer.local_time = 0;

//le delta du timer local
gameServer._dt = new Date().getTime();
gameServer._dte = new Date().getTime();

//File d'attente des messages dont on delai l'utilisation
gameServer.messages = [];

setInterval(function(){
    gameServer._dt = new Date().getTime() - gameServer._dte;
    gameServer._dte = new Date().getTime();
    gameServer.local_time += gameServer._dt/1000.0;
}, 1);

gameServer.onMessage = function(client, message) {

    var message_parts = message.split('.');
    var message_type = message_parts[0];

    var other_client = (client.game.player_host.userid == client.userid) ? client.game.player_client : client.game.player_host;

    if(message_type == 'i')
        this.onInput(client, message_parts);

    else if(message_type == 'p')
        client.send('s.p.' + message_parts[1]);

    else if(message_type == 'c') {
        if(other_client)
            other_client.send('s.c.' + message_parts[1]);
    }
};

gameServer.onInput = function(player, inputs) {
    var input_commands = inputs[1].split('-');
    var input_time = inputs[2].replace('-','.');
    var input_seq = inputs[3];

    if(player && player.game && player.game.gamecore)
        player.game.gamecore.handle_server_input(player, input_commands, input_time, input_seq);
};

//////////////////////////////////////////
////                                  ////
////            Définition            ////
////       de fonctions de base       ////
////                                  ////
//////////////////////////////////////////

//Création d'une nouvelle partie
//A appeller lorsque'il n'existe aucune partie ou que toutes les parties sont pleines
gameServer.createGame = function(player) {

    //Nouvelle instance de partie
    var instanceDePartie = {
            idDeLaPartie: UUID(),
            player_host: player,
            player_client: null,
            player_count: 1
        };

    //On stocke la nouvelle instance de partie dans la liste des partie à l'emplacement de son userid
    //De cette manière on peut y réacceder facilement avec son userid
    this.games[instanceDePartie.idDeLaPartie] = instanceDePartie;

    //Incrémentation du compteur de parties
    this.game_count++;

    //Création d'une instance de gameShared pour les collision, etc...
    instanceDePartie.gamecore = new gameShared(instanceDePartie);

    //On met à jour la boucle de jeu sur le serveur
    instanceDePartie.gamecore.update( new Date().getTime() );

    //On envoi un message au joueur pour lui dire que c'est l'hôte de la partie
    //Flag s = message venant du serveur
    //Flag h = vous êtes l'hôte
    player.send('s.h.'+ new String(instanceDePartie.gamecore.local_time).replace('.','-'));
    console.log('server host at  ' + instanceDePartie.gamecore.local_time);

    //On affecter cette instance de partie à la partie du joueur
    player.game = instanceDePartie;
    //Le joueur est l'hôte
    player.hosting = true;

    //Affichage dans la console de l'userid du joueur avec l'userid de la aprtie créée
    this.log('player ' + player.userid + ' created a game with userid ' + player.game.idDeLaPartie);

    return instanceDePartie;
};

//Suppression d'une partie
//A appeller lorsque tous l'un des joueurs quitte la partie
//Ou lors d'une collision
gameServer.endGame = function(idPartie, idClient) {

    var instanceDePartie = this.games[idPartie];

    //Si la partie existe
    if(instanceDePartie) {

        //On arrête la mise à jour de la partie
        instanceDePartie.gamecore.stop_update();

        //Si il reste plus de 1 seul joueur
        if(instanceDePartie.player_count > 1) {

            //Si l'hôte quitte
            if(idClient == instanceDePartie.player_host.userid) {

               //Alors on trouve une autre partie pour les joueurs restants
                if(instanceDePartie.player_client) {
                    instanceDePartie.player_client.send('s.e');
                    this.findGame(instanceDePartie.player_client);
                }
            //Si un autre joueur quitte
            } else {
                if(instanceDePartie.player_host) {

                    //Envoi du message de fin de partie à l'hôte
                    //Flag s = message venant du serveur
                    //Flag e = partie terminée
                    instanceDePartie.player_host.send('s.e');

                    //Comme la partie est terminée, il n'est plus hôte d'une partie
                    instanceDePartie.player_host.hosting = false;

                    //On essaie de lui touver une autre partie
                    this.findGame(instanceDePartie.player_host);
                }
            }
        }

        //On supprimer l'élément à la place idDeLaPartie de l'objet games
        delete this.games[idPartie];

        //On décrémente le compteur de partie
        this.game_count--;

        //Affichage dans la console de l'userid de la aprtie supprimé et du nombre de partie restant
        this.log('game ' + idPartie + ' removed. there are now ' + this.game_count + ' games' );

    //Si la partie n'existe pas
    } else
        this.log('game not found!');
};

//Démarrage d'une partie
//Dès qu'il y à deux joueur
gameServer.startGame = function(game) {


    //On dit au client qui rejoins la aprtie qu'il rejoins une partie
    //Flag s = message du serveur
    //Flag j = vous rejoignez une partie
    game.player_client.send('s.j.' + game.player_host.userid);

    //On met à jour la partie du joueur qui rejoint
    game.player_client.game = game;

    //On dit aux deux joueur que la partie démarre
    game.player_client.send('s.r.'+ String(game.gamecore.local_time).replace('.','-'));
    game.player_host.send('s.r.'+ String(game.gamecore.local_time).replace('.','-'));

    //Un booléen pour savoir si la partie est active
    game.active = true;
};

//Permet de trouver une partie pour un joueur
gameServer.findGame = function(player) {

    //Affichage dans la console qu'on est en train de chercher une partie
    this.log('looking for a game. We have : ' + this.game_count);

    //Si il existe au moins une partie
    if(this.game_count) {

        //Un booléen pour savoir si une partie a été trouvé
        var joined_a_game = false;

        //On parcours toutes les parties
        for(var gameid in this.games) {
            //if(!this.games.hasOwnProperty(gameid)) continue;

            //Création d'une instance de la partie qu'on examine
            var game_instance = this.games[gameid];

            //Si il manque un joueur dans la partie
            if(game_instance.player_count < 2) {

                //On a trouvé une partie
                joined_a_game = true;

                //On stocke le joueur dans cette partie
                //On incrémente le nombre de joueur
                game_instance.player_client = player;
                game_instance.gamecore.players.other.instance = player;
                game_instance.player_count++;

                //On démarre la partie
                this.startGame(game_instance);

            }
        }
        //Si on a pas trouvé de partie
        if(!joined_a_game)
            //On crée une nouvelle partie
            this.createGame(player);
    //Si il n'existe aucune partie
    } else
        //On crée un nouvelle partie
        this.createGame(player);
};


