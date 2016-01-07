
// Credit à Paul Irish pour l'API d'animation requestAnimationFrame
// http://paulirish.com/2011/requestanimationframe-for-smart-animating/

var frame_time = 60/1000; //60Hz soit ~16ms par frame
if(typeof(global) != 'undefined') frame_time = 45; //22Hz soit ~45ms par frame

( function () {
    var lastTime = 0;
    var vendors = [ 'ms', 'moz', 'webkit', 'o' ];

    for ( var x = 0; x < vendors.length && !window.requestAnimationFrame; ++ x ) {
        window.requestAnimationFrame = window[ vendors[ x ] + 'RequestAnimationFrame' ];
        window.cancelAnimationFrame = window[ vendors[ x ] + 'CancelAnimationFrame' ] || window[ vendors[ x ] + 'CancelRequestAnimationFrame' ];
    }

    if ( !window.requestAnimationFrame ) {
        window.requestAnimationFrame = function ( callback ) {
            var currTime = Date.now(),
                timeToCall = Math.max( 0, frame_time - ( currTime - lastTime ) );
            var id = window.setTimeout( function() {
                callback( currTime + timeToCall );
            }, timeToCall );

            lastTime = currTime + timeToCall;
            return id;
        };
    }

    if ( !window.cancelAnimationFrame ) {
        window.cancelAnimationFrame = function ( id ) {
            clearTimeout( id );
        };
    }
}());

//La classe de la partie
//On en crée une instance côté serveur pour chaque partie existante
//On en crée une côté client pour qu'il puisse jouer dessus
var gameShared = function(game_instance){
    //On stocke l'instance passé en argument
    this.instance = game_instance;

    //Si on est le serveur
    this.server = this.instance !== undefined;

    //Les limites du monde pour la gestion des collisions, etc...
    this.world = {
        width : 720,
        height : 480
    };

    //Création des joueurs
    if(this.server) {
        this.players = {
            self : new gamePlayer(this,this.instance.playerHost),
            other : new gamePlayer(this,this.instance.playerClient)
        };

        this.players.self.pos = {
            x:20,
            y:20
        };

    } else {
        this.players = {
            self : new gamePlayer(this),
            other : new gamePlayer(this)
        };

        //Position sur le serveur
        this.ghosts = {
            server_pos_self : new gamePlayer(this),
            serverOtherPos : new gamePlayer(this),
            otherPos : new gamePlayer(this)
        };
        this.ghosts.server_pos_self.pos = { x:20, y:20 };
        this.ghosts.serverOtherPos.pos = { x:700, y:20 };
        this.ghosts.otherPos.pos = { x:700, y:20 };
    }

    //La vitesse de déplacement du joueur
    this.playerspeed = 1.5;

    //Valeur pour la physique
    this._pdt = 0.0001;                 //Le delta
    this._pdte = new Date().getTime();  //Le delta e la dernière update de la physique

    //Valeur pour la précision client et serveur
    this.localTime = 0.016;            //Timer local
    this._dt = new Date().getTime();    //Delta du timer local
    this._dte = new Date().getTime();   //Le timer loal de la dernière frame

    //Boucle pour gérer la physique de base appelé toutes les 15ms
    this.clientStartPhysics();

    //Démarrage d'un timer pour mesurer le temps toutes les 1 ms
    this.clientStartTimer();

    //Initialisation spécifique client
    if(!this.server) {
        //Création de notre clavier d'évènement
        this.keyboard = new THREEx.KeyboardState();

        //Défini plusieurs variables pour le fonctionnement du jeu (temps, etc...)
        this.clientConfig();

        //La liste des mises à jour du serveur
        this.serverUpdates = [];

        //Connection au serveur socket.io
        this.clientConnection();

        //Détermine la couleur du joueur
        this.color = localStorage.getItem('color') || '#cc8822' ;
        localStorage.setItem('color', this.color);
        this.players.self.color = this.color;

    } else {
        this.serverTime = 0;
        this.laststate = {};
    }
};

//Côté serveur on ajoute une varible global de type global pour pouvoir l'utiliser partout
if( 'undefined' != typeof global ) {
    module.exports = global.gameShared = gameShared;
}

//////////////////////////////////////////
////                                  ////
////        Fonctions d'aide          ////
////                                  ////
//////////////////////////////////////////

//Méthode pour les flemmard
Number.prototype.fixed = function(n) {
    return parseFloat(this.toFixed(n));
};

//Recopie d'un vecteur
gameShared.prototype.pos = function(a) {
    return {
        x: a.x,
        y: a.y
    };
};

//Ajoute deux vecteur l'un a l'autre et retourne le récultat
gameShared.prototype.addVector = function(a,b) {
    return {
        x: (a.x + b.x).fixed(3),
        y: (a.y + b.y).fixed(3)
    };
};

//Arrêt de la boucle d'update
gameShared.prototype.stopUpdate = function() {
    window.cancelAnimationFrame(this.updateid);
};

//Interpolation lineaire entre 2 valeur
gameShared.prototype.lerp = function(p, n, t) {
    var _t = Number(t);
    _t = (Math.max(0, Math.min(1, _t))).fixed(3);
    return (p + _t * (n - p)).fixed(3);
};

//Interpolation linéaire entre deux vecteurs
gameShared.prototype.lerpVector = function(v, tv, t) {
    return {
        x: this.lerp(v.x, tv.x, t),
        y: this.lerp(v.y, tv.y, t)
    };
};

//La classe du joueur
//Permet de conserver l'état du joueur et de déssiner
var gamePlayer = function( game_instance, player_instance ) {

    //On socke les instance du joueur et de la partie en cours
    this.instance = player_instance;
    this.game = game_instance;

    //La direction courante du joueur
    this.currentDirection = null;

    //Initialisation des attributs de départ
    this.pos = {
        x:0,
        y:0
    };
    this.size = {
        x:8,
        y:8,
        hx: 4,
        hy: 4
    };
    this.state = 'Déconnecté';
    this.infoColor = 'rgba(255,255,255,0.1)';
    this.id = '';

    //Utiliser pour le mouvement
    this.old_state = {
        pos: {
            x:0,
            y:0
        }
    };
    this.cur_state = {
        pos: {
            x:0,
            y:0
        }
    };

    //Historique local des inputs des joueurs
    this.inputs = [];

    //Historique local des positions des joueurs
    this.history = [];

    //Les limites du plateau de jeu
    //La limite min sur l'axe x est la moitié de la taille de la moto
    //La limite max sur l'axe x est la largeur du canvas minus la moitié de la taille de la moto
    //La limite min sur l'axe y est la moitié de la taille de la moto
    //La limite max sur l'axe y est la hauteur du canvas minus la moitié de la taille de la moto
    this.pos_limits = {
        x_min: this.size.hx,
        x_max: this.game.world.width - this.size.hx,
        y_min: this.size.hy,
        y_max: this.game.world.height - this.size.hy
    };

    //L'hôte est déjà connu du serveur donc si un joueur est passé en paramètre du constructeur,
    //il s'agira de l'hôte.
    //On altère donc la position initial du joueur en fonction de sa qualité
    if(player_instance) {
        this.pos = {
            x:20,
            y:20
        };
    } else {
        this.pos = {
            x:700,
            y:20
        };
    }
};

gamePlayer.prototype.generateCoords = function(x, y){
    return x + "," + y;
};

//Prototype de la méthode de dessin
gamePlayer.prototype.draw = function(){
    //Change la couleur en fonction du statut
    game.ctx.fillStyle = this.infoColor;

    //Dessine la moto
    game.ctx.fillRect(this.pos .x - this.size.hx, this.pos.y - this.size.hy, this.size.x, this.size.y);
};

//////////////////////////////////////////
////                                  ////
////        Fonctions communes        ////
////                                  ////
//////////////////////////////////////////

//Prototype de la boucle de mise à jour
gameShared.prototype.update = function() {

    //En fonction de si on se trouve sur le client ou sur le serveur
    //on fait l'update adéquate
    if(!this.server)
        this.clientUpdate();
    else
        this.serverUpdate();

    //On prépare la prochaine mise à jour avec un callback sur cette méthode de mise à jour qu'on lie
    //à l'objet dans l'état
    this.updateid = window.requestAnimationFrame(this.update.bind(this));
};

//Prototype de la méthode de vérification des collisions contre le monde
gameShared.prototype.checkCollision = function( player ) {

    //Bordure ouest
    if(player.pos.x <= player.pos_limits.x_min){
        player.pos.x = player.pos_limits.x_min;
    }

    //Bordure est
    if(player.pos.x >= player.pos_limits.x_max ){
        player.pos.x = player.pos_limits.x_max;
    }

    //Bordure nord
    if(player.pos.y <= player.pos_limits.y_min){
        player.pos.y = player.pos_limits.y_min;
    }

    //Bordure sud
    if(player.pos.y >= player.pos_limits.y_max ){
        player.pos.y = player.pos_limits.y_max;
    }

    player.pos.x = player.pos.x.fixed(4);
    player.pos.y = player.pos.y.fixed(4);

};

//Prototype de la méthode pour gérer les évènement du joueur
gameShared.prototype.communProcessInputs = function( player ) {
    //On traite les évènement un par un
    var x_dir = 0;
    var y_dir = 0;
    var ic = player.inputs.length;

    //Si on a au moins 1 input
    if(ic) {
        for(var j = 0; j < ic; ++j) {

            //Inutile de traiter ceux qu'on à déjà traiter localement
            if(player.inputs[j].seq <= player.last_input_seq) continue;

            var input = player.inputs[j].inputs;
            for(var i = 0; i < input.length; ++i) {
                var key = input[i];
                if(key == 'l') {
                    x_dir -= 1;
                    var coords = player.generateCoords(player.pos.x-1, player.pos.y);
                    if(player.history.indexOf(coords) < 0)
                        player.history.push(coords);
                }
                if(key == 'r'){
                    x_dir += 1;
                    var coords = player.generateCoords(player.pos.x+1, player.pos.y);
                    if(player.history.indexOf(coords) < 0)
                        player.history.push(coords);
                }
                if(key == 'd'){
                    y_dir += 1;
                    var coords = player.generateCoords(player.pos.x, player.pos.y+1);
                    if(player.history.indexOf(coords) < 0)
                        player.history.push(coords);
                }
                if(key == 'u'){
                    y_dir -= 1;
                    var coords = player.generateCoords(player.pos.x, player.pos.y-1);
                    if(player.history.indexOf(coords) < 0)
                        player.history.push(coords);
                }
                //console.log(this.players.self.history);
            }
        }
    }

    //Calcul du vecteur résultat
    var resulting_vector = this.vectorWithSpeed(x_dir,y_dir);

    if(player.inputs.length) {
        //On stocke maintenant l'input dans les anciens
        player.last_input_time = player.inputs[ic-1].time;
        player.last_input_seq = player.inputs[ic-1].seq;
    }

    //On renvoi le vecteur de résultat
    return resulting_vector;
};

//Prototype de la méthode calculant le nouveau vecteur de position
gameShared.prototype.vectorWithSpeed = function(x,y) {

    //On retourne le nouveau vecteur de position en fonction de la vitesse
    return {
        x : (x * (this.playerspeed)).fixed(3),
        y : (y * (this.playerspeed)).fixed(3)
    };

};

//Prototype de la méthode de mise à jour en fonction du server ou du client
gameShared.prototype.communUpdatePhysics = function() {
    if(this.server)
        this.serverUpdatePhysics();
    else
        this.clientUpdatePhysics();
};

//////////////////////////////////////////
////                                  ////
////        Fonctions serveur         ////
////                                  ////
//////////////////////////////////////////

//Mis à jour de l'état du jeu toutes les 15ms
gameShared.prototype.serverUpdatePhysics = function() {

    //Mis à jour de l'hôte
    this.players.self.old_state.pos = this.pos( this.players.self.pos );
    var newVector = this.communProcessInputs(this.players.self);
    this.players.self.pos = this.addVector( this.players.self.old_state.pos, newVector );

    //Mis à jour des autres joueurs
    this.players.other.old_state.pos = this.pos( this.players.other.pos );
    var otherNewVector = this.communProcessInputs(this.players.other);
    this.players.other.pos = this.addVector( this.players.other.old_state.pos, otherNewVector);

    //Vérification des collision pour l'hôte
    this.checkCollision( this.players.self );

    //Vérification des collisions pour les autres joueurs
    this.checkCollision( this.players.other );

    //On libère le contenu de l'array
    this.players.self.inputs = [];
    this.players.other.inputs = [];
};

//On s'assure que le server envoie les mis à jour aux joueur
gameShared.prototype.serverUpdate = function(){

    //Mise à joure du timer local pour correspondre au timer
    this.serverTime = this.localTime;

    //On construit un état pour l'envoyer aux joueurs
    this.laststate = {
        hp  : this.players.self.pos,                //la position de l'hôte
        cp  : this.players.other.pos,               //la position des autres joueurs
        his : this.players.self.last_input_seq,     //les dernier inputs de l'hote
        cis : this.players.other.last_input_seq,    //les derniers inputs des autres joueurs
        t   : this.serverTime                      //le temps local serveur
    };

    //Envoi de l'état à l'hôte
    if(this.players.self.instance)
        this.players.self.instance.emit('onserverupdate', this.laststate );

    //Envoi de l'état au autres joueurs
    if(this.players.other.instance)
        this.players.other.instance.emit('onserverupdate', this.laststate );

};

//Prototype de la méthode pour gérer les évènements des joueurs sur le serveur
gameShared.prototype.serverProcessInputs = function(player, input, input_time, seqInput) {

    //On vérifie de quel joueur les évènements viennent
    var playerClient =
        (player.userid == this.players.self.instance.userid) ? this.players.self : this.players.other;

    //On stocke les inputs clients dans l'instance du joueur pour être traiter plus tard dans la boucle de mise à jour
    playerClient.inputs.push({
        inputs: input,
        time: input_time,
        seq: seqInput
    });
};


//////////////////////////////////////////
////                                  ////
////        Fonctions client          ////
////                                  ////
//////////////////////////////////////////

//Prototype de la fonction de gestion des évènement côté client
gameShared.prototype.clientProcessInputs = function(){

    var x_dir = 0;
    var y_dir = 0;
    var input = [];

    //On se déplace vers la gauche
    if( this.keyboard.pressed('Q') || this.keyboard.pressed('left')) {
        x_dir = -1;
        input.push('l');
    }

    //On se déplace vers la droite
    if( this.keyboard.pressed('D') || this.keyboard.pressed('right')) {
        x_dir = 1;
        input.push('r');
    }

    //On se déplace vers le bas
    if( this.keyboard.pressed('S') || this.keyboard.pressed('down')) {
        y_dir = 1;
        input.push('d');
    }

    //On se déplace vers le haut
    if( this.keyboard.pressed('Z') || this.keyboard.pressed('up')) {
        y_dir = -1;
        input.push('u');
    }

    //Si on à des évènements
    if(input.length) {
        //On incrémente le flag de séquence
        this.seqInput += 1;

        //On stocke dans notre liste d'évènement les évènement avec le temps local et le flag de séquence
        this.players.self.inputs.push({
            inputs : input,
            time : this.localTime.fixed(3),
            seq : this.seqInput
        });

        //On construit le packet
        var packet = 'i.';
        packet += input.join('-') + '.';
        packet += this.localTime.toFixed(3).replace('.','-') + '.';
        packet += this.seqInput;

        //On envoi le packet au serveur
        this.socket.send(packet);

        //On retourne le nouveau vecteur directionnel
        return this.vectorWithSpeed( x_dir, y_dir );

    //Sinon on ne bouge pas
    } else {
        return {
            x:0,
            y:0
        };
    }

};

//Prototype de la méthode de prédiction client sur le réseau
//Corriger les erreurs de mouvement si il y en à
gameShared.prototype.clientPredictionCorrection = function() {

    //Si il n'y à pas d'update serveur on ne fait rien
    if(!this.serverUpdates.length)
        return;

    //On récupère l'update serveur la plus récente
    var latestServerData = this.serverUpdates[this.serverUpdates.length-1];

    //Si c'est l'hote on récupère sa position sinon on récupère la position des autres joueurs
    var serverPos = this.players.self.host ? latestServerData.hp : latestServerData.cp;

    this.ghosts.server_pos_self.pos = this.pos(serverPos);

    //Si c'est l'hote on récupère ses évènements sinon on récupère les évènements des autres joueurs
    var lastInputOnServer = this.players.self.host ? latestServerData.his : latestServerData.cis;
    if(lastInputOnServer) {
        var lastInputSeqIndex = -1;

        //On cherche l'input dans la liste et on stocke l'index
        for(var i = 0; i < this.players.self.inputs.length; ++i) {
            if(this.players.self.inputs[i].seq == lastInputOnServer) {
                lastInputSeqIndex = i;
                break;
            }
        }

        //Si on a trouver l'input, on vire les mise à jour qu'on à déjà traiter
        if(lastInputSeqIndex != -1) {

            //On met l'index de prediction à linex confirmer par le serveur
            var indexToClear = Math.abs(lastInputSeqIndex - (-1));
            this.players.self.inputs.splice(0, indexToClear);

            //La position du client est déterminer par celle du serveur
            this.players.self.cur_state.pos = this.pos(serverPos);
            this.players.self.last_input_seq = lastInputSeqIndex;

            //On applique à nouveau les évènement qu'on à localement sur le client mais qui n'on pas été traiter sur
            //le serveur.
            this.clientUpdatePhysics();
            this.clientUpdatePos();
        }
    }
};

//Prototype de la méthode de traitement des mis à jour réseau
gameShared.prototype.clientProcessUpdate = function() {

    //Si il n'y à pas d'update serveur on ne fait rien
    if(!this.serverUpdates.length)
        return;

    //On stocke le timer local du client et le nombre d'update sur le serveur
    var currentTime = this.clientTime;
    var cpt = this.serverUpdates.length-1;
    var nextPos = null;
    var previousPos = null;

    //On regarde les plus ancienne mise à jour ver (de terre lol) les plus récentes
    //Au pire on parcours tout
    for(var i = 0; i < cpt; ++i) {
        //On stocke l'update i et l'update i+1
        var point = this.serverUpdates[i];
        var nextPoint = this.serverUpdates[i+1];

        //Compare nos positions dans le temps sur le serveur avec le temps local client
        if(point.t < currentTime && currentTime < nextPoint.t) {
            //Si le temps client est compris entre nos position dans le temps serveur
            nextPos = nextPoint;
            previousPos = point;
            break;
        }
    }

    //Si on ne trouve pas la cible on stocke la dernière position connue sur le serveur
    if(!nextPos) {
        nextPos = this.serverUpdates[0];
        previousPos = this.serverUpdates[0];
    }


    //Maintenant on peut interpoler por savoir ou à peu près on est entre les deux
    if(nextPos && previousPos) {
        this.seqTime = nextPos.t;
        var difference = this.seqTime - currentTime;
        var differenceMax = (nextPos.t - previousPos.t).fixed(3);

        //On obtient donc un pourcentage de la distance entre notre point temps client
        //et notre cible comparer à notre cible et à la valeur imédiate précédent sur le serveur
        var timePoint = (difference/differenceMax).fixed(3);

        //Du code de bourrin comme on peut pas diviser par zero (sans créer un trou noir),
        //si jamais c'est le cas on met à 0 notre distance
        if(isNaN(timePoint))
            timePoint = 0;
        if(timePoint == -Infinity)
            timePoint = 0;
        if(timePoint == Infinity)
            timePoint = 0;

        //La mise à jour al plus récente sur le serveur
        var latestServerData = this.serverUpdates[ this.serverUpdates.length-1 ];

        //Position exacte du serveur
        var serverOtherPos = this.players.self.host ? latestServerData.cp : latestServerData.hp;

        //La position des autres joueurs, avant et après
        var nextOtherPos = this.players.self.host ? nextPos.cp : nextPos.hp;
        var previousOtherPos = this.players.self.host ? previousPos.cp : previousPos.hp;

        //Mise à jour de la position des fantôme serveur
        this.ghosts.serverOtherPos.pos = this.pos(serverOtherPos);
        this.ghosts.otherPos.pos = this.lerpVector(previousOtherPos, nextOtherPos, timePoint);

        //Mise à jour de la position
        this.players.other.pos = this.lerpVector( this.players.other.pos, this.ghosts.otherPos.pos, this._pdt);

    }
};

//Prototype de la méthode de mise à jour du joueur lors de la reception de mise à jour serveur
gameShared.prototype.clientReceiveUpdate = function(data){

    //On récupère l'hote et le challenger
    var playerHost = this.players.self.host ?  this.players.self : this.players.other;
    var playerClient = this.players.self.host ?  this.players.other : this.players.self;

    //On récupère le temps du server (différent réellement du temps serveur à cause de la latence)
    this.serverTime = data.t;

    //Mise à jour du temps côté client en fonction du temps serveur
    this.clientTime = this.serverTime;

    //Approche basique où on recopie bêtement ce qu'envoie le serveur
    if(this.noob) {
        if(data.hp)
            playerHost.pos = this.pos(data.hp);
        if(data.cp)
            playerClient.pos = this.pos(data.cp);

    } else {
        //On garde en mémoire locale les données envoyées par le serveur
        this.serverUpdates.push(data);

        //On limite le nombre d'update en seconde ici 2 soit 120 update (60fps)
        if(this.serverUpdates.length >= ( 60*this.buffer ))
            this.serverUpdates.splice(0,1);

        //Gère la dernière position venant du serveur et corrige les predictions si besoin
        this.clientPredictionCorrection();
    }
};

//Prototype de la méthode de mise à jour du joueur avec la prédiction client
//PREDICTION CLIENT
gameShared.prototype.clientUpdatePos = function(){
    if(this.prediction) {
        //L'État actuel du joueur
        var currentState = this.players.self.cur_state.pos;

        //On met à jour la position du joueur
        this.players.self.pos = currentState;

        //On vérifie la collision
        this.checkCollision( this.players.self );
    }
};

//Prototype de la méthode mise à jour de la position du joueur
//PREDICTION CLIENT
gameShared.prototype.clientUpdatePhysics = function() {

    //On récupère la nouvelle direction depuis le buffer d'évènements
    //Ensuite on l'applique à l'état actuel
    if(this.prediction) {
        this.players.self.old_state.pos = this.pos( this.players.self.cur_state.pos );
        var newVector = this.communProcessInputs(this.players.self);
        this.players.self.cur_state.pos = this.addVector( this.players.self.old_state.pos, newVector);
        this.players.self.state_time = this.localTime;
    }
};

//Prototype de la méthode de mise à jour client de dessin
gameShared.prototype.clientUpdate = function() {

    //On gère les évènement client
    this.clientProcessInputs();

    //On met à jour les positions des autres joueurs
    this.clientProcessUpdate();

    //On redessine les autres joueurs
    this.players.other.draw();

    //On met à jour la position du joueur
    this.clientUpdatePos();

    //On redessine le joueur
    this.players.self.draw();
};

//Timer pour calcul du temps toutes les 1ms
gameShared.prototype.clientStartTimer = function(){
    setInterval(function(){
        this._dt = new Date().getTime() - this._dte;
        this._dte = new Date().getTime();
        this.localTime += this._dt/1000.0;
    }.bind(this), 1);
};

//Boucle toutes les 15ms pour la physique de jeu
gameShared.prototype.clientStartPhysics = function() {
    setInterval(function(){
        this._pdt = (new Date().getTime() - this._pdte)/1000.0;
        this._pdte = new Date().getTime();
        this.communUpdatePhysics();
    }.bind(this), 15);
};

//Configuration client
gameShared.prototype.clientConfig = function() {

    this.noob = true;
    this.prediction = true;
    this.seqInput = 0;

    this.buffer = 2;
    this.seqTime = 0.01;

    this.clientTime = 0.01;
    this.serverTime = 0.01;
};

//Prototype de la méthode lorsque qu'on reset les positions
gameShared.prototype.clientResetPos = function() {

    this.ctx.clearRect(0, 0, 720, 480);
    //Définition de l'hôte et des autre client
    var playerHost = this.players.self.host ?  this.players.self : this.players.other;
    var playerClient = this.players.self.host ?  this.players.other : this.players.self;

    //On vide l'historique des positions des joueurs
    playerHost.history = [];
    playerClient.history = [];

    //Position de l'hôte
    playerHost.pos = {
        x:20,
        y:20
    };

    //Position des autres joueurs
    playerClient.pos = {
        x:700,
        y:20
    };

    //On rajoute dans leur historique respectif la position initiale des joueurs
    playerHost.history.push(playerHost.generateCoords(playerHost.pos.x, playerHost.pos.y));
    playerClient.history.push(playerClient.generateCoords(playerClient.pos.x, playerClient.pos.y));

    //Mise à jour de la position locale du joueur
    this.players.self.old_state.pos = this.pos(this.players.self.pos);
    this.players.self.pos = this.pos(this.players.self.pos);
    this.players.self.cur_state.pos = this.pos(this.players.self.pos);

    this.ghosts.server_pos_self.pos = this.pos(this.players.self.pos);
    this.ghosts.serverOtherPos.pos = this.pos(this.players.other.pos);
    this.ghosts.otherPos.pos = this.pos(this.players.other.pos);
};

//Prototype de la méthode lors de la reception d'un message serveur nous disant qu'une partie est disponible
gameShared.prototype.clientLaunchGame = function(data) {

    //Le temps auquel le serveur à fait sa demande
    var serverTime = parseFloat(data.replace('-','.'));

    //Définition de l'hôte et des autre client
    var playerHost = this.players.self.host ?  this.players.self : this.players.other;
    var playerClient = this.players.self.host ?  this.players.other : this.players.self;

    //Estimation du temps actuel sur le serveur
    this.localTime = serverTime;

    //Affichage du temps du serveur sur la console CLIENT !!!!
    console.log('server time is about ' + this.localTime);

    //Couleur des joueurs
    playerHost.infoColor = '#2288cc';
    playerClient.infoColor = '#cc8822';

    //Mise à jour de l'état des joueurs
    playerHost.state = 'King';
    playerClient.state = 'Challenger';

    //Synchronisation couleurs
    this.socket.send('c.' + this.players.self.infoColor);
};

//Prototype de la méthode lors de la reception d'un message serveur nous demandant de rejoindre une partie
gameShared.prototype.clientOnJoin = function() {

    //Nous ne sommes pas hôte
    this.players.self.host = false;

    //État du joueur
    this.players.self.state = 'Challenger - ready to fight';
    this.players.self.infoColor = '#00bb00';

    //On reset les postion pour être sur d'être bien placer
    this.clientResetPos();
};

//Prototype de la méthode lors de la reception d'un message serveur nous demandant d'être hôte de partie
gameShared.prototype.clientOnHost = function(data) {

    //Le temps auquel le serveur à fait sa demande
    var serverTime = parseFloat(data.replace('-','.'));

    //Estimation du temps actuel sur le serveur
    this.localTime = serverTime;

    //Nous somme l'hôté
    this.players.self.host = true;

    //État du joueur
    this.players.self.state = 'The king - Awaiting challenger';
    this.players.self.infoColor = '#cc0000';

    //On reset les postion pour être sur d'être bien plaer
    this.clientResetPos();

};

//Prototype de la méthode lors de la reception d'un message serveur de connection
gameShared.prototype.clientOnConnected = function(data) {
    //On stocke des informations qui nous sont relatives
    //et on indique qu'on est prêt à jouer
    this.players.self.id = data.id;
    this.players.self.infoColor = '#cc0000';
    this.players.self.state = 'connected';
    this.players.self.online = true;
};

//Prototype de la méthode de changement de couleur des autres joueurs
gameShared.prototype.clientOtherColorChange = function(data) {
    this.players.other.infoColor = data;
};

//Prototype de la méthode lors de la reception d'un message serveur
gameShared.prototype.clientOnMessage = function(data) {

    //On parse le message
    var commands = data.split('.');
    var command = commands[0];
    var subCommand = commands[1] || null;
    var commandData = commands[2] || null;

    //On vérifie que le message est bien un message serveur
    switch(command) {
        case 's':
            //En fonction du deuxième flag on appelle la méthode adéquate
            switch(subCommand) {
                case 'h' :
                    this.clientOnHost(commandData); break;

                case 'j' :
                    this.clientOnJoin(commandData); break;

                case 'r' :
                    this.clientLaunchGame(commandData); break;

                case 'e' :
                    this.clientDeconnection(commandData); break;

                case 'c' :
                    this.clientOtherColorChange(commandData); break;
            }
            break;
    }
};

//Prototype de la méthode lorsqu'il y a deconnection
gameShared.prototype.clientDeconnection = function() {

    //On change l'état du joueur
    this.players.self.infoColor = 'rgba(255,255,255,0.1)';
    this.players.self.state = 'Deconnecté';
    this.players.self.online = false;

    //On change les états des autres joueurs
    this.players.other.infoColor = 'rgba(255,255,255,0.1)';
    this.players.other.state = 'Deconnecté';
};

//Prototype de la méthode de connection du client au serveur
gameShared.prototype.clientConnection = function() {

    //La socket de connection
    this.socket = io.connect();

    //Techniquement on est connecté uniquement lorsqu'on est dans un partie
    //Le serveur nous envoi donc un message pour ce cas
    this.socket.on('connect', function(){
        this.players.self.state = 'connecting';
    }.bind(this));

    //Reception du message serveur lorsqu'on se deconnecte
    this.socket.on('disconnect', this.clientDeconnection.bind(this));

    //Reception du message des mises à jour du serveur
    this.socket.on('onserverupdate', this.clientReceiveUpdate.bind(this));

    //Reception du message serveur lorsqu'on se connecte
    this.socket.on('onconnected', this.clientOnConnected.bind(this));

    //Reception du message serveur lorsqu'il y a une erreur
    this.socket.on('error', this.clientDeconnection.bind(this));

    //Reception d'un message serveur
    this.socket.on('message', this.clientOnMessage.bind(this));
};

