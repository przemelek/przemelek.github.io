var currentlySelected="";
function $(id) { return document.getElementById(id); }
var fibonacciVal = ["0","1","2","3","5","8","13","21","34","55","89","?","Coffee","Clear"];
var normalVal = ["0","1/2","1","2","3","5","8","13","20","40","100","?","Coffee","Clear"];
var val = normalVal;

function show(value) {
   if (value=="Clear") {
      $("res").innerHTML="";
   } else {
      $("res").innerHTML="<div style='font-size:1em'>Calculating...</div>";;

      var sizeV = Math.round($("res").clientWidth*0.9/16/(value.length)*2);
      var textHeight = $("res").parentNode.clientHeight;
      var sizeH = Math.floor(textHeight/16);
      var size = sizeV;
      if (size>sizeH) size=sizeH;
      console.log($("res").style["line-height"]);
      var resHeight = screen.availHeight-$("buttons").clientHeight;
      $("res").style["line-height"]=textHeight+"px";
      $("res").innerHTML="<div style='font-size:"+size+"em'>"+value+"</div>";
      $("res").clientHeight=resHeight+"px";

      // var sizeV = Math.round($("res").clientWidth/16/(value.length)*2);
      // var textHeight = $("res").parentNode.clientHeight;
      // var sizeH = Math.floor(textHeight/24);
      // var size = sizeV;
      // if (size>sizeH) size=sizeH;
      // console.log($("res").style["line-height"]);
      // $("res").style["line-height"]=textHeight+"px";
      // $("res").innerHTML="<div style='font-size:"+size+"em'>"+value+"</div>";
   }
}

function click(elem) {
   var value = elem.currentTarget.innerHTML;
   currentlySelected=value;
   show(value);
}

function init() {
  val = normalVal;
  if (JSON.parse(localStorage["fibonacci"]||"false")) val = fibonacciVal;
  var c = "";
  for (var i=0; i<val.length; i++) {
     c+="<button class='agileButton' id='button"+i+"' >"+val[i]+"</button>"
  }
  $("buttons").innerHTML=c;
  for (var i=0; i<val.length; i++) {
     $("button"+i).onclick=click;
  }
  $("gear").addEventListener("click",function(e) {
    $("settings").style["display"]="block";
  });
  $("cancel").addEventListener("click",function(e) {
    $("settings").style["display"]="none";
  });
  $("save").addEventListener("click",function(e) {
    $("settings").style["display"]="none";
    localStorage["fibonacci"]=$("fib").checked;
    init();
    show("")
  });
  $("fib").checked=JSON.parse(localStorage["fibonacci"]||"false");
}


window.addEventListener('load', function(e) {
  init();
  show(currentlySelected);
}, false);

window.addEventListener("resize", function(e) {
  show(currentlySelected);
},  false);
