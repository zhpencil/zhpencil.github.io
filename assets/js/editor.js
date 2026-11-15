// 临时 Markdown 编辑器
(function () {
	var input = document.getElementById('markdown-input');
	var preview = document.getElementById('markdown-preview');
	var status = document.getElementById('editor-status');
	var toolbar = document.querySelector('.editor_toolbar');
	var copyButton = document.getElementById('editor-copy');
	var downloadButton = document.getElementById('editor-download');
	if (!input || !preview || !status) return;

	function pad(number) {
		return (number < 10 ? '0' : '') + number;
	}

	function today() {
		var date = new Date();
		return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
	}

	var dateElement = document.getElementById('editor-date');
	if (dateElement) dateElement.textContent = today();

	function updateStatus(message) {
		if (message) {
			status.textContent = message;
			return;
		}
		var value = input.value;
		var lines = value ? value.split('\n').length : 0;
		status.textContent = value.length + ' 字符 · ' + lines + ' 行 · 临时内容，刷新后会清空';
	}

	function render() {
		var value = input.value;
		if (window.marked && typeof window.marked.parse === 'function') {
			preview.innerHTML = window.marked.parse(value, { gfm: true, breaks: true });
		} else {
			preview.textContent = value;
		}
		updateStatus();
	}

	function wrap(before, after, placeholder) {
		var start = input.selectionStart;
		var end = input.selectionEnd;
		var selected = input.value.slice(start, end) || placeholder || '';
		input.setRangeText(before + selected + after, start, end, 'end');
		if (start === end && placeholder) {
			input.setSelectionRange(start + before.length, start + before.length + placeholder.length);
		}
		input.focus();
		render();
	}

	function prefixLines(prefix) {
		var start = input.selectionStart;
		var end = input.selectionEnd;
		var value = input.value;
		var lineStart = value.lastIndexOf('\n', start - 1) + 1;
		var lineEnd = value.indexOf('\n', end);
		if (lineEnd === -1) lineEnd = value.length;
		var block = value.slice(lineStart, lineEnd);
		var changed = block.split('\n').map(function (line) {
			return prefix + line;
		}).join('\n');
		input.setRangeText(changed, lineStart, lineEnd, 'end');
		if (start === end) {
			var position = start + prefix.length;
			input.setSelectionRange(position, position);
		} else {
			input.setSelectionRange(lineStart, lineStart + changed.length);
		}
		input.focus();
		render();
	}

	if (toolbar) {
		toolbar.addEventListener('click', function (event) {
			var button = event.target.closest ? event.target.closest('button[data-action]') : null;
			if (!button) return;
			switch (button.getAttribute('data-action')) {
				case 'bold':
					wrap('**', '**', '粗体文字');
					break;
				case 'italic':
					wrap('*', '*', '斜体文字');
					break;
				case 'heading':
					prefixLines('## ');
					break;
				case 'list':
					prefixLines('- ');
					break;
				case 'quote':
					prefixLines('> ');
					break;
				case 'link':
					wrap('[', '](https://)', '链接文字');
					break;
				case 'code':
					wrap('\n```\n', '\n```\n', 'code');
					break;
				case 'clear':
					if (input.value === '' || window.confirm('清空当前内容？')) {
						input.value = '';
						input.focus();
						render();
					}
					break;
			}
		});
	}

	input.addEventListener('input', render);

	input.addEventListener('keydown', function (event) {
		if (!(event.ctrlKey || event.metaKey)) return;
		var key = event.key.toLowerCase();
		if (key === 'b') {
			event.preventDefault();
			wrap('**', '**', '粗体文字');
		} else if (key === 'i') {
			event.preventDefault();
			wrap('*', '*', '斜体文字');
		}
	});

	function legacyCopy(text) {
		var area = document.createElement('textarea');
		area.value = text;
		area.style.position = 'fixed';
		area.style.opacity = '0';
		document.body.appendChild(area);
		area.select();
		var copied = false;
		try {
			copied = document.execCommand('copy');
		} catch (error) {
			copied = false;
		}
		document.body.removeChild(area);
		return copied;
	}

	function copyText(text) {
		if (navigator.clipboard && navigator.clipboard.writeText) {
			return navigator.clipboard.writeText(text).catch(function () {
				if (!legacyCopy(text)) throw new Error('copy failed');
			});
		}
		return new Promise(function (resolve, reject) {
			legacyCopy(text) ? resolve() : reject(new Error('copy failed'));
		});
	}

	if (copyButton) {
		copyButton.addEventListener('click', function () {
			copyText(input.value).then(function () {
				updateStatus('已复制 Markdown 到剪贴板');
				setTimeout(updateStatus, 2000);
			}).catch(function () {
				updateStatus('复制失败，请手动选择文本');
				setTimeout(updateStatus, 2000);
			});
		});
	}

	if (downloadButton) {
		downloadButton.addEventListener('click', function () {
			var blob = new Blob([input.value], { type: 'text/markdown;charset=utf-8' });
			var url = URL.createObjectURL(blob);
			var link = document.createElement('a');
			link.href = url;
			link.download = 'new-' + today() + '.md';
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			setTimeout(function () {
				URL.revokeObjectURL(url);
			}, 1000);
			updateStatus('已下载 ' + link.download);
			setTimeout(updateStatus, 2000);
		});
	}

	render();
})();