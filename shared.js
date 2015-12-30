
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
        window.requestAnimationFrame = function ( callback, element ) {
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

}() );

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

        //A VIRER
        this.ghosts = {
            server_pos_self : new game_player(this),
            server_pos_other : new game_player(this),
            pos_other : new game_player(this)
        };

        this.ghosts.pos_other.state = 'dest_pos';

        this.ghosts.pos_other.info_color = 'rgba(255,255,255,0.1)';

        this.ghosts.server_pos_self.info_color = 'rgba(255,255,255,0.2)';
        this.ghosts.server_pos_other.info_color = 'rgba(255,255,255,0.2)';

        this.ghosts.server_pos_self.state = 'server_pos';
        this.ghosts.server_pos_other.state = 'server_pos';

        this.ghosts.server_pos_self.pos = { x:20, y:20 };
        this.ghosts.pos_other.pos = { x:500, y:200 };
        this.ghosts.server_pos_other.pos = { x:500, y:200 };
    }

    //La vitesse de déplacement du joueur
    this.playerspeed = 2;

    //Set up some physics integration values
    this._pdt = 0.0001;                 //The physics update delta time
    this._pdte = new Date().getTime();  //The physics update last delta time

    //A local timer for precision on server and client
    this.local_time = 0.016;            //The local timer
    this._dt = new Date().getTime();    //The local timer delta
    this._dte = new Date().getTime();   //The local timer last frame time

    //Start a physics loop, this is separate to the rendering
    //as this happens at a fixed frequency
    this.create_physics_simulation();

    //A VOIR
    this.create_timer();

    //Client specific initialisation
    if(!this.server) {
        //Création de notre clavier d'évènement
        this.keyboard = new THREEx.KeyboardState();

        //A REDEFINIR OU A VIRER
        this.client_create_configuration();

        //La liste des mises à jour du serveur
        this.server_updates = [];

        //Connect to the socket.io server!
        this.client_connect_to_server();

        //A VIRER
        this.client_create_ping_timer();

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
    n = n || 3;
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
        x: (a.x+b.x).fixed(),
        y: (a.y+b.y).fixed()
    };
};

//A VIRER
gameShared.prototype.v_sub = function(a,b) {
    return {
        x: (a.x-b.x).fixed(),
        y: (a.y-b.y).fixed()
    };
};

//A VIRER
gameShared.prototype.v_mul_scalar = function(a,b) {
    return {
        x: (a.x*b).fixed(),
        y: (a.y*b).fixed()
    };
};

//Arrêt de la boucle d'update
gameShared.prototype.stop_update = function() {
    window.cancelAnimationFrame(this.updateid);
};

//Interpolation lineaire
gameShared.prototype.lerp = function(p, n, t) {
    var _t = Number(t); _t = (Math.max(0, Math.min(1, _t))).fixed();
    return (p + _t * (n - p)).fixed();
};

//Interpolation linéaire entre deux vecteurs
gameShared.prototype.v_lerp = function(v,tv,t) {
    return { x: this.lerp(v.x, tv.x, t), y:this.lerp(v.y, tv.y, t) };
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
    this.state = 'not-connected';
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

    //État utiliser pour al prédiction
    this.state_time = new Date().getTime();

    //Historique local des inputs des joueurs
    this.inputs = [];

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
            x:500,
            y:200
        };
    }

};

//Prototype de la méthode de dessin
game_player.prototype.draw = function(){

    //La couleur du joueur
    game.ctx.fillStyle = this.color;

    //Dessine la moto
    game.ctx.fillRect(this.pos.x - this.size.hx, this.pos.y - this.size.hy, this.size.x, this.size.y);

    //Change la couleur en fonction du statut
    game.ctx.fillStyle = this.info_color;

    //Affichage d'un texte ici le statut
    /////!!!!!!!!!!!!! A CHANGER POUR LE NOM DU JOUEUR !!!!!!!!!!!!!!!/////
    game.ctx.fillText(this.state, this.pos.x+10, this.pos.y + 4);

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
        this.lastframetime ? ( (t - this.lastframetime)/1000.0).fixed() : 0.016;

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

//Prototype de la méthode de vérification des collisions
gameShared.prototype.check_collision = function( player ) {

    //Bordure ouest
    if(player.pos.x <= player.pos_limits.x_min)
        player.pos.x = player.pos_limits.x_min;

    //Bordure est
    if(player.pos.x >= player.pos_limits.x_max )
        player.pos.x = player.pos_limits.x_max;

    //Bordure nord
    if(player.pos.y <= player.pos_limits.y_min)
        player.pos.y = player.pos_limits.y_min;

    ///Bordure sud
    if(player.pos.y >= player.pos_limits.y_max )
        player.pos.y = player.pos_limits.y_max;

    player.pos.x = player.pos.x.fixed(4);
    player.pos.y = player.pos.y.fixed(4);

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
            //don't process ones we already have simulated locally
            if(player.inputs[j].seq <= player.last_input_seq) continue;

            var input = player.inputs[j].inputs;
            for(var i = 0; i < input.length; ++i) {
                var key = input[i];
                if(key == 'l')
                    x_dir -= 1;
                if(key == 'r')
                    x_dir += 1;
                if(key == 'd')
                    y_dir += 1;
                if(key == 'u')
                    y_dir -= 1;
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
        x : (x * (this.playerspeed)).fixed(),
        y : (y * (this.playerspeed)).fixed()
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
gameShared.prototype.handle_server_input = function(client, input, input_time, input_seq) {

    //On vérifie de quel joueur les évènements viennent
    var player_client =
        (client.userid == this.players.self.instance.userid) ?
            this.players.self : this.players.other;

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

    //This takes input from the client and keeps a record,
    //It also sends the input information to the server immediately
    //as it is pressed. It also tags each input with a sequence number.

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
            time : this.local_time.fixed(),
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
        if(this.client_smoothing)
            this.players.other.pos = this.v_lerp( this.players.other.pos, this.ghosts.pos_other.pos, this._pdt * this.client_smooth);
        else
            this.players.other.pos = this.pos(this.ghosts.pos_other.pos);

        //Si jamais on utilise pas la prédiction client
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
            if(this.client_smoothing)
                this.players.self.pos = this.v_lerp( this.players.self.pos, local_target, this._pdt*this.client_smooth);
            else
                this.players.self.pos = this.pos( local_target );
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
    var this_player = this.players.self;

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

        if(data.hp) {
            player_host.pos = this.pos(data.hp);
        }

        if(data.cp) {
            player_client.pos = this.pos(data.cp);
        }

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

    //On efface le dessin
    this.ctx.clearRect(0,0,720,480);

    //A VIRER
    this.client_draw_info();

    //On gère les évènement client
    this.client_handle_input();

    //On met à jour les positions des autres joueurs
    if( !this.naive_approach ) {
        this.client_process_net_updates();
    }

    //On redessine les autres joueurs
    this.players.other.draw();

    //On met à jour la position du joueur
    this.client_update_local_position();

    //On redessine le joueur
    this.players.self.draw();

    //A VIRER
    if(this.show_dest_pos && !this.naive_approach)
        this.ghosts.pos_other.draw();

    //A VIRER
    if(this.show_server_pos && !this.naive_approach) {
        this.ghosts.server_pos_self.draw();
        this.ghosts.server_pos_other.draw();
    }

    //Work out the fps average
    this.client_refresh_fps();

};

//A VOIR
gameShared.prototype.create_timer = function(){
    setInterval(function(){
        this._dt = new Date().getTime() - this._dte;
        this._dte = new Date().getTime();
        this.local_time += this._dt/1000.0;
    }.bind(this), 4);
}

//Boucle toutes les 15ms
gameShared.prototype.create_physics_simulation = function() {

    setInterval(function(){
        this._pdt = (new Date().getTime() - this._pdte)/1000.0;
        this._pdte = new Date().getTime();
        this.update_physics();
    }.bind(this), 15);

};

//Creation du timer pour le ping de 1s
gameShared.prototype.client_create_ping_timer = function() {
    setInterval(function(){
        this.last_ping_time = new Date().getTime() - this.fake_lag;
        this.socket.send('p.' + (this.last_ping_time) );
    }.bind(this), 1000);

};

//A REDEFINIR OU VIRER COMPLETEMENT
gameShared.prototype.client_create_configuration = function() {

    this.show_help = false;
    this.naive_approach = false;
    this.show_server_pos = false;
    this.show_dest_pos = false;
    this.client_predict = true;
    this.input_seq = 0;
    this.client_smoothing = true;
    this.client_smooth = 25;

    this.net_latency = 0.001;
    this.net_ping = 0.001;
    this.last_ping_time = 0.001;
    this.fake_lag = 0;

    this.net_offset = 100;
    this.buffer_size = 2;
    this.target_time = 0.01;

    this.client_time = 0.01;
    this.server_time = 0.01;

    this.dt = 0.016;
    this.fps = 0;
    this.fps_avg_count = 0;
    this.fps_avg = 0;
    this.fps_avg_acc = 0;
};

//A VIRER
gameShared.prototype.client_create_debug_gui = function() {

    this.gui = new dat.GUI();

    var _playersettings = this.gui.addFolder('Your settings');

    this.colorcontrol = _playersettings.addColor(this, 'color');

    this.colorcontrol.onChange(function(value) {
        this.players.self.color = value;
        localStorage.setItem('color', value);
        this.socket.send('c.' + value);
    }.bind(this));

    _playersettings.open();

    var _othersettings = this.gui.addFolder('Methods');

    _othersettings.add(this, 'naive_approach').listen();
    _othersettings.add(this, 'client_smoothing').listen();
    _othersettings.add(this, 'client_smooth').listen();
    _othersettings.add(this, 'client_predict').listen();

    var _debugsettings = this.gui.addFolder('Debug view');

    _debugsettings.add(this, 'show_help').listen();
    _debugsettings.add(this, 'fps_avg').listen();
    _debugsettings.add(this, 'show_server_pos').listen();
    _debugsettings.add(this, 'show_dest_pos').listen();
    _debugsettings.add(this, 'local_time').listen();

    _debugsettings.open();

    var _consettings = this.gui.addFolder('Connection');
    _consettings.add(this, 'net_latency').step(0.001).listen();
    _consettings.add(this, 'net_ping').step(0.001).listen();

    var lag_control = _consettings.add(this, 'fake_lag').step(0.001).listen();
    lag_control.onChange(function(value){
        this.socket.send('l.' + value);
    }.bind(this));

    _consettings.open();

    var _netsettings = this.gui.addFolder('Networking');

    _netsettings.add(this, 'net_offset').min(0.01).step(0.001).listen();
    _netsettings.add(this, 'server_time').step(0.001).listen();
    _netsettings.add(this, 'client_time').step(0.001).listen();

    _netsettings.open();

};

//Prototype de la méthode lorsque qu'on reset les positions
gameShared.prototype.client_reset_positions = function() {

    //Définition de l'hôte et des autre client
    ////!!!!!!! A MODIFIER POUR GERER PLUSIEURS JOUEURS !!!!!!!!/////
    var player_host = this.players.self.host ?  this.players.self : this.players.other;
    var player_client = this.players.self.host ?  this.players.other : this.players.self;

    //Position de l'hôte
    player_host.pos = {
        x:20,
        y:20
    };
    //Position des autres joueurs
    ////!!!!!!! A MODIFIER POUR GERER PLUSIEURS JOUEURS !!!!!!!!/////
    player_client.pos = {
        x:500,
        y:200
    };

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

    //Pour indiquer au joueur qui il est
    this.players.self.state = '*' + this.players.self.state;

    //Synchronisation couleurs
    this.socket.send('c.' + this.players.self.color);

};

//Prototype de la méthode lors de la reception d'un message serveur nous demandant de rejoindre une partie
gameShared.prototype.client_onjoingame = function(data) {

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

//Calcul du ping et la latence réseau
gameShared.prototype.client_onping = function(data) {
    this.net_ping = new Date().getTime() - parseFloat( data );
    this.net_latency = this.net_ping/2;
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

                case 'p' :
                    this.client_onping(commanddata); break;
                case 'c' : //other player changed colors
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

//Prototype de la méthode de calcul des FPS moyen du client
gameShared.prototype.client_refresh_fps = function() {
    this.fps = 1/this.dt;
    this.fps_avg_acc += this.fps;
    this.fps_avg_count++;

    //On lisse le fps sur 10 images
    if(this.fps_avg_count >= 10) {

        this.fps_avg = this.fps_avg_acc/10;
        this.fps_avg_count = 1;
        this.fps_avg_acc = this.fps;

    } //reached 10 frames

};

//A VIRER
gameShared.prototype.client_draw_info = function() {

    this.ctx.fillStyle = 'rgba(255,255,255,0.3)';

    if(this.show_help) {

        this.ctx.fillText('net_offset : local offset of others players and their server updates. Players are net_offset "in the past" so we can smoothly draw them interpolated.', 10 , 30);
        this.ctx.fillText('server_time : last known game time on server', 10 , 70);
        this.ctx.fillText('client_time : delayed game time on client for other players only (includes the net_offset)', 10 , 90);
        this.ctx.fillText('net_latency : Time from you to the server. ', 10 , 130);
        this.ctx.fillText('net_ping : Time from you to the server and back. ', 10 , 150);
        this.ctx.fillText('fake_lag : Add fake ping/lag for testing, applies only to your inputs (watch server_pos block!). ', 10 , 170);
        this.ctx.fillText('client_smoothing/client_smooth : When updating players information from the server, it can smooth them out.', 10 , 210);
        this.ctx.fillText(' This only applies to other clients when prediction is enabled, and applies to local player with no prediction.', 170 , 230);

    }

    if(this.players.self.host) {

        this.ctx.fillStyle = 'rgba(255,255,255,0.7)';
        this.ctx.fillText('Vous êtes l\'hôte', 10 , 465);

    }

    this.ctx.fillStyle = 'rgba(255,255,255,1)';
};
