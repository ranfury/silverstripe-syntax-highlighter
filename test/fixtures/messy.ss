<div class="wrap">
<h1>$Title</h1>
        <% if $Content %>
    <div class="content">
<p>$Content</p>
              </div>
<% else %>
<p>Nothing</p>
        <% end_if %>
   <svg class="icon" viewBox="0 0 24 24">
<g clip-path="url(#c)">
        <path d="M3 6h18" stroke="#000"/>
              <circle cx="5" cy="5" r="4"/>
</g>
   <defs>
<clipPath id="c">
<rect width="24" height="24"/>
</clipPath>
    </defs>
        </svg>
<a
href="$Link"
class="btn"
>
<span>Go</span>
</a>
<%if $A&&not $B%>
<img src="x.png" alt="y">
<%   end_if   %>
<pre>
     keep   this
        exactly as-is
</pre>
<script>
    const a = {
  b: 1
    };
</script>
</div>
