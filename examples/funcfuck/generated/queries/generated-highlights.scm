"def" @keyword
"emit" @keyword
"repeat" @function.builtin
(INTEGER) @number
(id) @function.builtin
(inc) @function.builtin
(dec) @function.builtin
(double) @function.builtin
(square) @function.builtin
(neg) @function.builtin
(sum) @function.builtin
(product) @function.builtin
(first) @function.builtin
(last) @function.builtin
(add) @function.builtin
(mul) @function.builtin
(take) @function.builtin
(drop) @function.builtin
"(" @punctuation.bracket
")" @punctuation.bracket
"," @punctuation.delimiter
";" @punctuation.delimiter
"=" @operator
"=>" @operator
">>" @operator
"[" @punctuation.bracket
"]" @punctuation.bracket
(add "add" @keyword)
(definition "def" @keyword)
(drop "drop" @keyword)
(emit "emit" @keyword)
(mul "mul" @keyword)
(repeat "repeat" @keyword)
(take "take" @keyword)
(builtin) @function.builtin
(integer_values) @number
(integer_tail) @number
