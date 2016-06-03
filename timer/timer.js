function $(id) { return document.getElementById(id); };
function lz(t) { if (t.length<2) t="0"+t; return t; };

var buttons = [
  { name : "Idę spać",
    time : "0:00"
  },
  { name : "Wstałem",
    time : "8:00"
  },
  { name : "Wyjście z domu",
    time : "9:00"
  },
  { name : "Śniadanie",
    time : "10:00"
  },
  { name : "Przyjście do pracy",
    time : "9:30"
  },
  { name : "Lunch",
    time : "13:00"
  },
  { name : "Wyjście z pracy",
    time : "17:30"
  },
  { name : "Przyjście do domu",
    time : "18:30"
  },
  { name : "Medytacja",
    time : "21:10"
  }


];

var colors = ["bisque","yellow","orange","lightblue"];

var content = "";
for (var i=0; i<buttons.length; i++) {
   var b = "<button id='b"+i+"' style='background-color:"+colors[i%colors.length]+"'>"+buttons[i].name+"</button></br>";
   content+=b;
}
$("content").innerHTML=content;

function init() {
   var elems = document.getElementsByTagName("button");
   for (var i = 0; i<elems.length; i++) {
      if (elems[i].id && elems[i].id.startsWith("b")) {
      console.log(elems[i].innerText);
      elems[i].onclick=function(e) {
         var d = new Date();
         var time = lz(""+d.getHours())+":"+lz(""+d.getMinutes());
         var line = time+" "+e.srcElement.innerText+"<br />";
         var old = localStorage["report"];
         if (!old) old = "";
         old+=line;
         localStorage["report"] = old;
         showReport();
      }
      }
   }
}


function showReport() {
         text = localStorage["report"];
         $("report").innerHTML=text;
}

function clear() {
    localStorage["report"]="";
    showReport();
}

$("clear").onclick=clear;
setTimeout(init,100);
showReport()
