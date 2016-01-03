
/* *********************************
 **********************************
 */

var socket = io();
var i;

/*** Fonctions utiles ***/

/**
 * Scroll vers le bas de page si l'utilisateur n'est pas remonté pour lire d'anciens messages
 */
function scrollToBottom() {
    if ($(window).scrollTop() + $(window).height() + 2 * $('#messages li').last().outerHeight() >= $(document).height()) {
        $('html, body').animate({ scrollTop: $(document).height() }, 0);
    }
}

/*** Gestion des événements ***/

/**
 * Connexion de l'utilisateur
 * Uniquement si le username n'est pas vide et n'existe pas encore
 */
$('#login form').submit(function (e) {
    e.preventDefault();
    var user = {
        username : $('#login input').val().trim()
    };
    if (user.username.length > 0) { // Si le champ de connexion n'est pas vide
        socket.emit('user-login', user, function (success) {
            if (success) {
                $('body').removeAttr('id'); // Cache formulaire de connexion
                $('#chat input').focus(); // Focus sur le champ du message
            }
        });
    }
});


/**
 * Connexion d'un nouvel utilisateur
 */
socket.on('user-login', function (user) {
    $('#users').append($('<li class="' + user.username + ' new">').html(user.username + '<span class="typing">typing</span>'));
    setTimeout(function () {
        $('#users li.new').removeClass('new');
    }, 1000);
});

/**
 * Déconnexion d'un utilisateur
 */
socket.on('user-logout', function (user) {
    var selector = '#users li.' + user.username;
    $(selector).remove();
});






//Variable globale de fenêtre
var game = {};

//Appellée lors du chargement
window.onload = function(){

	//On crée un nouvelle instance de partie
	game = new gameShared();

		//On recupère le canvas
		game.viewport = document.getElementById('viewport');
			
		//On ajuste la taille
		game.viewport.width = game.world.width;
		game.viewport.height = game.world.height;

		//On recupère le contexte
		game.ctx = game.viewport.getContext('2d');

		//On défini le style de dessin
		game.ctx.font = '11px "Helvetica"';

	//On lance la boucle
	game.update( new Date().getTime() );
};
