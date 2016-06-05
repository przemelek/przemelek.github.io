var currentlySelected="";
function $(id) { return document.getElementById(id); }
var fibonacciVal = ["0","1","2","3","5","8","13","21","34","55","89","?","Coffee","Clear"];
var val = ["0","1/2","1","2","3","5","8","13","20","40","100","?","Coffee","Clear"];
if (localStorage["fibonacci"]) val = fibonacciVal;

function show(value) {
   if (value=="Clear") {
      $("res").innerHTML="";
   } else {
      $("res").innerHTML="<div style='font-size:1em'>Calculating...</div>";;
      var sizeV = Math.round($("res").clientWidth/16/(value.length)*2);
      var sizeH = Math.floor($("res").parentNode.clientHeight/24);
      var size = sizeV;
      if (size>sizeH) size=sizeH;
      $("res").innerHTML="<div style='font-size:"+size+"em'>"+value+"</div>";
   }
}

function click(elem) {
   var value = elem.currentTarget.innerHTML;
   currentlySelected=value;
   show(value);
}

function init() {
  var c = "";
  for (var i=0; i<val.length; i++) {
     c+="<button class='agileButton' id='button"+i+"' >"+val[i]+"</button>"
  }
  $("buttons").innerHTML=c;
  for (var i=0; i<val.length; i++) {
     $("button"+i).onclick=click;
  }
}


window.addEventListener('load', function(e) {
  init();
  show(currentlySelected);
}, false);

window.addEventListener("resize", function(e) {
  show(currentlySelected);
},  false);
