
// Credit à Paul Irish pour l'API d'animation requestAnimationFrame
// http://paulirish.com/2011/requestanimationframe-for-smart-animating/

var frame_time = 60/1000; //60Hz soit ~16ms par frame
if('undefined' != typeof(global)) frame_time = 45; //22Hz soit ~45ms par frame

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

    this.over = false;

    //Création des joueurs
    if(this.server) {
        this.players = {
            self : new game_player(this,this.instance.player_host),
            other : new game_player(this,this.instance.player_client)
        };

        this.players.self.pos = {
            x:20,
            y:20
        };

    } else {
        this.players = {
            self : new game_player(this),
            other : new game_player(this)
        };

        //Position sur le serveur
        this.ghosts = {
            server_pos_self : new game_player(this),
            server_pos_other : new game_player(this),
            pos_other : new game_player(this)
        };
        this.ghosts.server_pos_self.pos = { x:20, y:20 };
        this.ghosts.server_pos_other.pos = { x:700, y:20 };
        this.ghosts.pos_other.pos = { x:700, y:20 };
    }

    //La vitesse de déplacement du joueur
    this.playerspeed = 1.5;

    //Set up some physics integration values
    this._pdt = 0.0001;                 //The physics update delta time
    this._pdte = new Date().getTime();  //The physics update last delta time

    //A local timer for precision on server and client
    this.local_time = 0.016;            //Timer local
    this._dt = new Date().getTime();    //Delta du timer local
    this._dte = new Date().getTime();   //Le timer loal de la dernière frame

    //Boucle pour gérer la physique de base appelé toutes les 15ms
    this.create_physics_simulation();

    //Démarrage d'un timer pour mesurer le temps toutes les 1 ms
    this.create_timer();

    //Initialisation spécifique client
    if(!this.server) {
        //Création de notre clavier d'évènement
        this.keyboard = new THREEx.KeyboardState();

        //Défini plusieurs variables pour le fonctionnement du jeu (temps, etc...)
        this.client_create_configuration();

        //La liste des mises à jour du serveur
        this.server_updates = [];

        //Connection au serveur socket.io
        this.client_connect_to_server();

        //Détermine la couleur du joueur
        this.color = localStorage.getItem('color') || '#cc8822' ;
        localStorage.setItem('color', this.color);
        this.players.self.color = this.color;

    } else {
        this.server_time = 0;
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
gameShared.prototype.v_add = function(a,b) {
    return {
        x: (a.x + b.x).fixed(3),
        y: (a.y + b.y).fixed(3)
    };
};

//Arrêt de la boucle d'update
gameShared.prototype.stop_update = function() {
    window.cancelAnimationFrame(this.updateid);
};

//Interpolation lineaire entre 2 valeur
gameShared.prototype.lerp = function(p, n, t) {
    var _t = Number(t);
    _t = (Math.max(0, Math.min(1, _t))).fixed(3);
    return (p + _t * (n - p)).fixed(3);
};

//Interpolation linéaire entre deux vecteurs
gameShared.prototype.v_lerp = function(v, tv, t) {
    return {
        x: this.lerp(v.x, tv.x, t),
        y: this.lerp(v.y, tv.y, t)
    };
};

//La classe du joueur
//Permet de conserver l'état du joueur et de déssiner
var game_player = function( game_instance, player_instance ) {

    //On socke les instance du joueur et de la partie en cours
    this.instance = player_instance;
    this.game = game_instance;

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
    this.color = 'rgba(255,255,255,0.1)';
    this.info_color = 'rgba(255,255,255,0.1)';
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

game_player.prototype.generateCoords = function(x, y){
    return x + "," + y;
};

//Prototype de la méthode de dessin
game_player.prototype.draw = function(){
    //Change la couleur en fonction du statut
    game.ctx.fillStyle = this.info_color;
    game.ctx.beginPath();
    game.ctx.moveTo(this.pos.x - this.size.hx , this.pos.y - this.size.hy);
    game.ctx.lineTo(this.pos.x + this.size.hx, this.pos.y - this.size.hy);
    game.ctx.lineTo(this.pos.x + this.size.hx, this.pos.y + this.size.hy);
    game.ctx.lineTo(this.pos.x - this.size.hx, this.pos.y + this.size.hy);
    game.ctx.closePath();
    game.ctx.fill();

    //Dessine la moto
    //game.ctx.fillRect(this.pos .x - this.size.hx, this.pos.y - this.size.hy, this.size.x, this.size.y);

    //Affichage d'un texte ici le statut
    /////!!!!!!!!!!!!! A CHANGER POUR LE NOM DU JOUEUR !!!!!!!!!!!!!!!/////
    //game.ctx.fillText(this.state, this.pos.x+10, this.pos.y + 4);

};

//////////////////////////////////////////
////                                  ////
////        Fonctions communes        ////
////                                  ////
//////////////////////////////////////////

//Prototype de la boucle de mise à jour
gameShared.prototype.update = function(t) {

    //Calcul du delta pour que le déplacement soit indépendant du framerate
    //Formule delta =
    //Par défaut 0.016 soit un delta qui correspond à 60FPS / 60Hz
    this.dt =
        this.lastframetime ? ( (t - this.lastframetime)/1000.0).fixed(3) : 0.016;

    //On stocke le temps de la dernière frame pour recalculer le prochain delta
    this.lastframetime = t;

    //En fonction de si on se trouve sur le client ou sur le serveur
    //on fait l'update adéquate
    if(!this.server)
        this.client_update();
    else
        this.server_update();

    //On prépare la prochaine mise à jour avec un callback sur cette méthode de mise à jour qu'on lie
    //à l'objet dans l'état
    this.updateid = window.requestAnimationFrame(this.update.bind(this));
};

//Prototype de la méthode de vérification des collisions contre le monde
gameShared.prototype.check_collision = function( player ) {

    //Bordure ouest
    if(player.pos.x <= player.pos_limits.x_min){
        this.over = true;
        player.pos.x = player.pos_limits.x_min;
    }

    //Bordure est
    if(player.pos.x >= player.pos_limits.x_max ){
        this.over = true;
        player.pos.x = player.pos_limits.x_max;
    }

    //Bordure nord
    if(player.pos.y <= player.pos_limits.y_min){
        this.over = true;
        player.pos.y = player.pos_limits.y_min;
    }

    //Bordure sud
    if(player.pos.y >= player.pos_limits.y_max ){
        this.over = true;
        player.pos.y = player.pos_limits.y_max;
    }

    player.pos.x = player.pos.x.fixed(4);
    player.pos.y = player.pos.y.fixed(4);

};

//Prototype de la méthode de collision entre les joueurs
gameShared.prototype.isCollision = function(player1, player2){
    var coords = player1.generateCoords(player1.pos.x, player1.pos.y);

    console.log(coords + "    |    " + player1.history + "    |     " + player2.history);
   /* if( player1.history.indexOf(coords) ||
        player2.history.indexOf(coords) ) {
    }*/

};

//Prototype de la méthode pour gérer les évènement du joueur
gameShared.prototype.process_input = function( player ) {
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
    var resulting_vector = this.physics_movement_vector_from_direction(x_dir,y_dir);

    if(player.inputs.length) {
        //On stocke maintenant l'input dans les anciens
        player.last_input_time = player.inputs[ic-1].time;
        player.last_input_seq = player.inputs[ic-1].seq;
    }

    //On renvoi le vecteur de résultat
    return resulting_vector;
};

//Prototype de la méthode calculant le nouveau vecteur de position
gameShared.prototype.physics_movement_vector_from_direction = function(x,y) {

    //On retourne le nouveau vecteur de position en fonction de la vitesse
    return {
        x : (x * (this.playerspeed)).fixed(3),
        y : (y * (this.playerspeed)).fixed(3)
    };

};

//Prototype de la méthode de mise à jour en fonction du server ou du client
gameShared.prototype.update_physics = function() {
    if(this.server)
        this.server_update_physics();
    else
        this.client_update_physics();
};

//////////////////////////////////////////
////                                  ////
////        Fonctions serveur         ////
////                                  ////
//////////////////////////////////////////

//Mis à jour de l'état du jeu toutes les 15ms
gameShared.prototype.server_update_physics = function() {

    //Mis à jour de l'hôte
    this.players.self.old_state.pos = this.pos( this.players.self.pos );
    var new_dir = this.process_input(this.players.self);
    this.players.self.pos = this.v_add( this.players.self.old_state.pos, new_dir );

    //Mis à jour des autres joueurs
    ////!!!!!!!!!! A MODIFIER POUR GERER PLUSIEUR JOUEUR !!!!!!!!!!!!!////
    this.players.other.old_state.pos = this.pos( this.players.other.pos );
    var other_new_dir = this.process_input(this.players.other);
    this.players.other.pos = this.v_add( this.players.other.old_state.pos, other_new_dir);

    //Vérification des collision pour l'hôte
    this.check_collision( this.players.self );

    //Vérification des collisions pour les autres joueurs
    ////!!!!!!!!!! A MODIFIER POUR GERER PLUSIEUR JOUEUR !!!!!!!!!!!!!////
    this.check_collision( this.players.other );

    //On dump le contenu du buffer d'évènement
    this.players.self.inputs = [];
    this.players.other.inputs = [];
};

//On s'assure que le server envoie les mis à jour aux joueur
gameShared.prototype.server_update = function(){

    //Mise à joure du timer local pour correspondre au timer
    this.server_time = this.local_time;

    //On construit un état pour l'envoyer aux joueurs
    this.laststate = {
        hp  : this.players.self.pos,                //la position de l'hôte
        cp  : this.players.other.pos,               //la position des autres joueurs ////!!!!!!!!!! A MODIFIER POUR GERER PLUSIEUR JOUEUR !!!!!!!!!!!!!////
        his : this.players.self.last_input_seq,     //les dernier inputs de l'hote
        cis : this.players.other.last_input_seq,    //les derniers inputs des autres joueurs ////!!!!!!!!!! A MODIFIER POUR GERER PLUSIEUR JOUEUR !!!!!!!!!!!!!////
        t   : this.server_time                      // le temps local serveur
    };

    //Envoi de l'état à l'hôte
    if(this.players.self.instance)
        this.players.self.instance.emit('onserverupdate', this.laststate );

    //Envoi de l'état au autres joueurs
    ////!!!!!!!!!! A MODIFIER POUR GERER PLUSIEUR JOUEUR !!!!!!!!!!!!!////
    if(this.players.other.instance)
        this.players.other.instance.emit('onserverupdate', this.laststate );

};

//Prototype de la méthode pour gérer les évènements des joueurs sur le serveur
gameShared.prototype.handle_server_input = function(player, input, input_time, input_seq) {

    //On vérifie de quel joueur les évènements viennent
    var player_client =
        (player.userid == this.players.self.instance.userid) ? this.players.self : this.players.other;

    //On stocke les inputs clients dans l'instance du joueur pour être traiter plus tard dans la boucle de mise à jour
    player_client.inputs.push({
        inputs: input,
        time: input_time,
        seq: input_seq
    });

};


//////////////////////////////////////////
////                                  ////
////        Fonctions client          ////
////                                  ////
//////////////////////////////////////////

//Prototype de la fonction de gestion des évènement côté client
gameShared.prototype.client_handle_input = function(){

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
        this.input_seq += 1;

        //On stocke dans notre liste d'évènement les évènement avec le temps local et le flag de séquence
        this.players.self.inputs.push({
            inputs : input,
            time : this.local_time.fixed(3),
            seq : this.input_seq
        });

        //On construit le packet
        var server_packet = 'i.';
        server_packet += input.join('-') + '.';
        server_packet += this.local_time.toFixed(3).replace('.','-') + '.';
        server_packet += this.input_seq;

        //On envoi le packet au serveur
        this.socket.send(  server_packet  );

        //On retourne le nouveau vecteur directionnel
        return this.physics_movement_vector_from_direction( x_dir, y_dir );

    //Sinon on ne bouge pas
    ////!!!! GERER ICI LE MOUVEMENT CONTINUE !!!!////
    } else {
        return {
            x:0,
            y:0
        };
    }

};

//Prototype de la méthode de prédiction client sur le réseau
//Corriger les erreurs de mouvement si il y en à
gameShared.prototype.client_process_net_prediction_correction = function() {

    //Si il n'y à pas d'update serveur on ne fait rien
    if(!this.server_updates.length)
        return;

    //On récupère l'update serveur la plus récente
    var latest_server_data = this.server_updates[this.server_updates.length-1];

    //Si c'est l'hote on récupère sa position sinon on récupère la position des autres joueurs
    ////!!!!!! A MODIFIER POUR GERER PLUSIEURS JOUEURS !!!!!/////
    var my_server_pos = this.players.self.host ? latest_server_data.hp : latest_server_data.cp;

    //A VIRER
    this.ghosts.server_pos_self.pos = this.pos(my_server_pos);

    //Si c'est l'hote on récupère ses évènements sinon on récupère les évènements des autres joueurs
    ////!!!!!! A MODIFIER POUR GERER PLUSIEURS JOUEURS !!!!!/////
    var my_last_input_on_server = this.players.self.host ? latest_server_data.his : latest_server_data.cis;
    if(my_last_input_on_server) {
        var lastinputseq_index = -1;

        //On cherche l'input dans la liste et on stocke l'index
        for(var i = 0; i < this.players.self.inputs.length; ++i) {
            if(this.players.self.inputs[i].seq == my_last_input_on_server) {
                lastinputseq_index = i;
                break;
            }
        }

        //Si on a trouver l'input, on vire les mise à jour qu'on à déjà traiter
        if(lastinputseq_index != -1) {

            //On met l'index de prediction à linex confirmer par le serveur
            var number_to_clear = Math.abs(lastinputseq_index - (-1));
            this.players.self.inputs.splice(0, number_to_clear);

            //La position du client est déterminer par celle du serveur
            this.players.self.cur_state.pos = this.pos(my_server_pos);
            this.players.self.last_input_seq = lastinputseq_index;

            //On applique à nouveau les évènement qu'on à localement sur le client mais qui n'on pas été traiter sur
            //le serveur.
            this.client_update_physics();
            this.client_update_local_position();
        }
    }
};

//Prototype de la méthode de traitement des mis à jour réseau
gameShared.prototype.client_process_net_updates = function() {

    //Si il n'y à pas d'update serveur on ne fait rien
    if(!this.server_updates.length)
        return;

    //On stocke le timer local du client et le nombre d'update sur le serveur
    var current_time = this.client_time;
    var count = this.server_updates.length-1;
    var target_pos = null;
    var previous_pos = null;

    //On regarde les plus ancienne mise à jour ver (de terre lol) les plus récentes
    //Au pire on parcours tout
    for(var i = 0; i < count; ++i) {
        //On stocke l'update i et l'update i+1
        var point = this.server_updates[i];
        var next_point = this.server_updates[i+1];

        //Compare nos positions dans le temps sur le serveur avec le temps local client
        if(point.t < current_time && current_time < next_point.t) {
            //Si le temps client est compris entre nos position dans le temps serveur
            target_pos = next_point;
            previous_pos = point;
            break;
        }
    }

    //Si on ne trouve pas la cible on stocke la dernière position connue sur le serveur
    if(!target_pos) {
        target_pos = this.server_updates[0];
        previous_pos = this.server_updates[0];
    }


    //Maintenant on peut interpoler por savoir ou à peu près on est entre les deux
    if(target_pos && previous_pos) {

        this.target_time = target_pos.t;
        var difference = this.target_time - current_time;
        var max_difference = (target_pos.t - previous_pos.t).fixed(3);

        //On obtient donc un pourcentage de la distance entre notre point temps client
        //et notre cible comparer à notre cible et à la valeur imédiate précédent sur le serveur
        var time_point = (difference/max_difference).fixed(3);

        //Du code de bourrin comme on peut pas diviser par zero (sans créer un trou noir),
        //si jamais c'est le cas on met à 0 notre distance
        if( isNaN(time_point) ) time_point = 0;
        if(time_point == -Infinity) time_point = 0;
        if(time_point == Infinity) time_point = 0;

        //La mise à jour al plus récente sur le serveur
        var latest_server_data = this.server_updates[ this.server_updates.length-1 ];

        //Position exacte du serveur
        var other_server_pos = this.players.self.host ? latest_server_data.cp : latest_server_data.hp;

        //La position des autres joueurs, avant et après
        var other_target_pos = this.players.self.host ? target_pos.cp : target_pos.hp;
        var other_past_pos = this.players.self.host ? previous_pos.cp : previous_pos.hp;

        //A VIRER
        this.ghosts.server_pos_other.pos = this.pos(other_server_pos);
        this.ghosts.pos_other.pos = this.v_lerp(other_past_pos, other_target_pos, time_point);

        //Dépend si on utilise le lissage de déplacement
        this.players.other.pos = this.v_lerp( this.players.other.pos, this.ghosts.pos_other.pos, this._pdt * this.client_smooth);


        //Si jamais on utilise pas la prédiction client ni l'approche naive
        if(!this.client_predict && !this.naive_approach) {

            //Position exacte du serveur
            var my_server_pos = this.players.self.host ? latest_server_data.hp : latest_server_data.cp;

            //La position des autres joueurs, avant et après
            var my_target_pos = this.players.self.host ? target_pos.hp : target_pos.cp;
            var my_past_pos = this.players.self.host ? previous_pos.hp : previous_pos.cp;

            //A VIRER
            this.ghosts.server_pos_self.pos = this.pos(my_server_pos);
            var local_target = this.v_lerp(my_past_pos, my_target_pos, time_point);

            //Dépend si on utilise le lissage de déplacement
            this.players.self.pos = this.v_lerp( this.players.self.pos, local_target, this._pdt*this.client_smooth);
        }
    }
};

//Prototype de la méthode de mise à jour du joueur lors de la reception de mise à jour serveur
gameShared.prototype.client_onserverupdate_received = function(data){

    //Lets clarify the information we have locally. One of the players is 'hosting' and
    //the other is a joined in client, so we name these host and client for making sure
    //the positions we get from the server are mapped onto the correct local sprites
    var player_host = this.players.self.host ?  this.players.self : this.players.other;
    var player_client = this.players.self.host ?  this.players.other : this.players.self;

    //Store the server time (this is offset by the latency in the network, by the time we get it)
    this.server_time = data.t;
    //Update our local offset time from the last server update
    this.client_time = this.server_time - (this.net_offset/1000);

    //One approach is to set the position directly as the server tells you.
    //This is a common mistake and causes somewhat playable results on a local LAN, for example,
    //but causes terrible lag when any ping/latency is introduced. The player can not deduce any
    //information to interpolate with so it misses positions, and packet loss destroys this approach
    //even more so. See 'the bouncing ball problem' on Wikipedia.

    if(this.naive_approach) {

        if(data.hp)
            player_host.pos = this.pos(data.hp);

        if(data.cp)
            player_client.pos = this.pos(data.cp);

    } else {

        //Cache the data from the server,
        //and then play the timeline
        //back to the player with a small delay (net_offset), allowing
        //interpolation between the points.
        this.server_updates.push(data);

        //we limit the buffer in seconds worth of updates
        //60fps*buffer seconds = number of samples
        if(this.server_updates.length >= ( 60*this.buffer_size )) {
            this.server_updates.splice(0,1);
        }

        //We can see when the last tick we know of happened.
        //If client_time gets behind this due to latency, a snap occurs
        //to the last tick. Unavoidable, and a reallly bad connection here.
        //If that happens it might be best to drop the game after a period of time.
        this.oldest_tick = this.server_updates[0].t;

        //Handle the latest positions from the server
        //and make sure to correct our local predictions, making the server have final say.
        this.client_process_net_prediction_correction();

    } //non naive

};

//Prototype de la méthode de mise à jour du joueur avec la prédiction client
gameShared.prototype.client_update_local_position = function(){

    if(this.client_predict) {
        //L'État actuel du joueur
        var current_state = this.players.self.cur_state.pos;

        //On met à jour la position du joueur
        this.players.self.pos = current_state;

        //On vérifie la collision
        this.check_collision( this.players.self );
        this.isCollision(this.players.self, this.players.other)
    }
};

//Prototype de la méthode mise à jour de la position du joueur
gameShared.prototype.client_update_physics = function() {

    //On récupère la nouvelle direction depuis le buffer d'évènements
    //Ensuite on l'applique à l'état actuel
    if(this.client_predict) {
        this.players.self.old_state.pos = this.pos( this.players.self.cur_state.pos );
        var nd = this.process_input(this.players.self);
        this.players.self.cur_state.pos = this.v_add( this.players.self.old_state.pos, nd);
        this.players.self.state_time = this.local_time;
    }
};

//Prototype de la méthode de mise à jour client de dessin
gameShared.prototype.client_update = function() {

    //On gère les évènement client
    this.client_handle_input();

    //On met à jour les positions des autres joueurs
    this.client_process_net_updates();

    //On redessine les autres joueurs
    this.players.other.draw();

    //On met à jour la position du joueur
    this.client_update_local_position();

    //On redessine le joueur
    this.players.self.draw();
};

//Timer pour calcul du temps toutes les 1ms
gameShared.prototype.create_timer = function(){
    setInterval(function(){
        this._dt = new Date().getTime() - this._dte;
        this._dte = new Date().getTime();
        this.local_time += this._dt/1000.0;
    }.bind(this), 1);
};

//Boucle toutes les 15ms
gameShared.prototype.create_physics_simulation = function() {

    setInterval(function(){
        this._pdt = (new Date().getTime() - this._pdte)/1000.0;
        this._pdte = new Date().getTime();
        this.update_physics();
    }.bind(this), 15);

};

//A REDEFINIR OU VIRER COMPLETEMENT
gameShared.prototype.client_create_configuration = function() {

    this.naive_approach = true;
    this.client_predict = false;
    this.input_seq = 0;
    this.client_smooth = 25;

    this.net_latency = 0.001;

    this.net_offset = 100;
    this.buffer_size = 2;
    this.target_time = 0.01;

    this.client_time = 0.01;
    this.server_time = 0.01;
};

//Prototype de la méthode lorsque qu'on reset les positions
gameShared.prototype.client_reset_positions = function() {

    this.ctx.clearRect(0, 0, 720, 480);
    //Définition de l'hôte et des autre client
    ////!!!!!!! A MODIFIER POUR GERER PLUSIEURS JOUEURS !!!!!!!!/////
    var player_host = this.players.self.host ?  this.players.self : this.players.other;
    var player_client = this.players.self.host ?  this.players.other : this.players.self;

    //On vide l'historique des positions des joueurs
    player_host.history = [];
    player_client.history = [];

    //Position de l'hôte
    player_host.pos = {
        x:20,
        y:20
    };

    //Position des autres joueurs
    ////!!!!!!! A MODIFIER POUR GERER PLUSIEURS JOUEURS !!!!!!!!/////
    player_client.pos = {
        x:700,
        y:20
    };

    //On rajoute dans leur historique respectif la position initiale des joueurs
    player_host.history.push(player_host.generateCoords(player_host.pos.x, player_host.pos.y));
    player_client.history.push(player_client.generateCoords(player_client.pos.x, player_client.pos.y));

    //Mise à jour de la position locale du joueur
    this.players.self.old_state.pos = this.pos(this.players.self.pos);
    this.players.self.pos = this.pos(this.players.self.pos);
    this.players.self.cur_state.pos = this.pos(this.players.self.pos);

    //A VIRER
    this.ghosts.server_pos_self.pos = this.pos(this.players.self.pos);

    //CA AUSSI !!!
    this.ghosts.server_pos_other.pos = this.pos(this.players.other.pos);
    this.ghosts.pos_other.pos = this.pos(this.players.other.pos);
};

//Prototype de la méthode lors de la reception d'un message serveur nous disant qu'une partie est disponible
gameShared.prototype.client_onreadygame = function(data) {

    //Le temps auquel le serveur à fait sa demande
    var server_time = parseFloat(data.replace('-','.'));

    //Définition de l'hôte et des autre client
    ////!!!!!!! A MODIFIER POUR GERER PLUSIEURS JOUEURS !!!!!!!!/////
    var player_host = this.players.self.host ?  this.players.self : this.players.other;
    var player_client = this.players.self.host ?  this.players.other : this.players.self;

    //Estimation du temps actuel sur le serveur
    this.local_time = server_time + this.net_latency;

    //Affichage du temps du serveur sur la console CLIENT !!!!
    console.log('server time is about ' + this.local_time);

    //Couleur des joueurs
    player_host.info_color = '#2288cc';
    player_client.info_color = '#cc8822';

    //Update their information
    player_host.state = 'King';
    player_client.state = 'Challenger';

    //Synchronisation couleurs
    this.socket.send('c.' + this.players.self.color);
};

//Prototype de la méthode lors de la reception d'un message serveur nous demandant de rejoindre une partie
gameShared.prototype.client_onjoingame = function() {

    //Nous ne sommes pas hôte
    this.players.self.host = false;

    //État du joueur
    this.players.self.state = 'Challenger - ready to fight';
    this.players.self.info_color = '#00bb00';

    //On reset les postion pour être sur d'être bien placer
    this.client_reset_positions();
};

//Prototype de la méthode lors de la reception d'un message serveur nous demandant d'être hôte de partie
gameShared.prototype.client_onhostgame = function(data) {

    //Le temps auquel le serveur à fait sa demande
    var server_time = parseFloat(data.replace('-','.'));

    //Estimation du temps actuel sur le serveur
    this.local_time = server_time + this.net_latency;

    //Nous somme l'hôté
    this.players.self.host = true;

    //État du joueur
    this.players.self.state = 'The king - Awaiting challenger';
    this.players.self.info_color = '#cc0000';

    //On reset les postion pour être sur d'être bien plaer
    this.client_reset_positions();

};

//Prototype de la méthode lors de la reception d'un message serveur de connection
gameShared.prototype.client_onconnected = function(data) {
    //On stocke des informations qui nous sont relatives
    //et on indique qu'on est prêt à jouer
    this.players.self.id = data.id;
    this.players.self.info_color = '#cc0000';
    this.players.self.state = 'connected';
    this.players.self.online = true;
};

//A VIRER
gameShared.prototype.client_on_otherclientcolorchange = function(data) {
    this.players.other.color = data;
};

//Prototype de la méthode lors de la reception d'un message serveur
gameShared.prototype.client_onnetmessage = function(data) {

    //On parse le message
    var commands = data.split('.');
    var command = commands[0];
    var subcommand = commands[1] || null;
    var commanddata = commands[2] || null;

    //On vérifie que le message est bien un message serveur
    switch(command) {
        case 's':
            //En fonction du deuxième flag on appelle la méthode adéquate
            switch(subcommand) {
                case 'h' :
                    this.client_onhostgame(commanddata); break;

                case 'j' :
                    this.client_onjoingame(commanddata); break;

                case 'r' :
                    this.client_onreadygame(commanddata); break;

                case 'e' :
                    this.client_ondisconnect(commanddata); break;

                case 'c' :
                    this.client_on_otherclientcolorchange(commanddata); break;
            }
            break;
    }
};

//Prototype de la méthode lorsqu'il y a deconnection
gameShared.prototype.client_ondisconnect = function(data) {

    //On change l'état du joueur
    this.players.self.info_color = 'rgba(255,255,255,0.1)';
    this.players.self.state = 'not-connected';
    this.players.self.online = false;

    //On change les états des autres joueurs
    /////!!!!! A MODIFIER POUR GERER PLUSIEURS JOUEURS !!!!!//////
    this.players.other.info_color = 'rgba(255,255,255,0.1)';
    this.players.other.state = 'not-connected';
};

//Prototype de la méthode de connection du client au serveur
gameShared.prototype.client_connect_to_server = function() {

    //La socket de connection
    this.socket = io.connect();

    //Techniquement on est connecté uniquement lorsqu'on est dans un partie
    //Le serveur nous envoi donc un message pour ce cas
    this.socket.on('connect', function(){
        this.players.self.state = 'connecting';
    }.bind(this));

    //Reception du message serveur lorsqu'on se deconnecte
    this.socket.on('disconnect', this.client_ondisconnect.bind(this));

    //Reception du message des mises à jour du serveur
    this.socket.on('onserverupdate', this.client_onserverupdate_received.bind(this));

    //Reception du message serveur lorsqu'on se connecte
    this.socket.on('onconnected', this.client_onconnected.bind(this));

    //Reception du message serveur lorsqu'il y a une erreur
    this.socket.on('error', this.client_ondisconnect.bind(this));

    //Reception d'un message serveur
    this.socket.on('message', this.client_onnetmessage.bind(this));
};

