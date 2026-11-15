// By: h01000110 (hi)
// github.com/h01000110

function numbers () {
	var fields = document.querySelectorAll("pre > code");
	for (var i = 0; i < fields.length; i++) {
		var field = fields[i];
		var select = field.innerText;
		var select_f = select.split(/\n/);

		// 去掉代码块末尾多余的空行
		if (select_f.length && select_f[select_f.length - 1] === "") {
			select_f.pop();
		}

		var tab = document.createElement("table");
		field.innerHTML = "";
		field.appendChild(tab);

		for (var line = 0; line < select_f.length; line++) {
			var row = document.createElement("tr");
			var col = document.createElement("th");
			var colc = document.createElement("th");
			col.innerText = line + 1;
			colc.innerText = select_f[line];
			row.appendChild(col);
			row.appendChild(colc);
			tab.appendChild(row);

			// 行号与代码的样式
			col.style.textAlign = "right";
			colc.style.textAlign = "left";
			tab.style.border = "0";
			col.style.border = "0";
			colc.style.border = "0";
			col.style.padding = "3px";
			colc.style.padding = "3px";
			col.style.borderRight = "2px solid #777777";
			col.style.fontWeight = "normal";
			colc.style.fontWeight = "normal";
		}
	}
}

window.addEventListener("load", numbers);