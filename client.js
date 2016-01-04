//Variable globale de fenêtre
var game = {};

//Appellée lors du chargement
window.onload = function(){

	//On crée un nouvelle instance de partie
	game = new gameShared();

		//On recupère le canvas
		game.gamefield = document.getElementById('gamefield');
			
		//On ajuste la taille
		game.gamefield.width = game.world.width;
		game.gamefield.height = game.world.height;

		//On recupère le contexte
		game.ctx = game.gamefield.getContext('2d');

		//On défini le style de dessin
		game.ctx.font = '11px "Helvetica"';

	//On lance la boucle
	game.update( new Date().getTime() );
};