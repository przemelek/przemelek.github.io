function showP(position) {
   var lat = position.coords.latitude;
   var lon = position.coords.longitude;
   var today = new Date();
   var elems = set_rise(today,lat,lon).split(",");
   var alt = "";
   if (position.coords.altitude!=null) {
     alt = " ("+position.coords.altitude+"m)";
   }
   var zaw = "<center style='font-size:1.5em'>("+lat+","+lon+alt+")<br /><hr width='25%' />";
   zaw+="<span style='font-size:1.25em'>Today</span><br />";
   zaw+="<span style='font-size:2em'>Sunrise: "+elems[0]+"<br />";
   zaw+="Sunset: "+elems[1]+"<br /></span><hr width='25%' />";
   var tomorrow = new Date();
   tomorrow.setDate(today.getDate()+1);
   elems = set_rise(tomorrow,lat,lon).split(",");
   zaw+="<span style='font-size:1em'>Tomorrow<br />Sunrise: "+elems[0]+"<br />";
   zaw+="Sunset: "+elems[1]+"<br /></span><hr width='25%' />";
   zaw+="</center>";
   document.getElementById("content").innerHTML=zaw;
}
function handleError(err) {
  document.getElementById("content").innerHTML=err;
}
function refresh() {
	navigator.geolocation.getCurrentPosition(showP,handleError);
}

refresh();

document.getElementById("refreshButton").onclick=refresh;

window.addEventListener('load', function(e) {

  window.applicationCache.addEventListener('updateready', function(e) {
    console.log("Do magic");
    if (window.applicationCache.status == window.applicationCache.UPDATEREADY) {
      window.location.reload();
    }
  }, false);

}, false);
