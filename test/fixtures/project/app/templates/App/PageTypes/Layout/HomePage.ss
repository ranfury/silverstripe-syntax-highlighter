<div class="home">
    <h1>$Title</h1>
    <p class="tagline">$Tagline</p>
    <p>$Subtitle</p>
    <span>$ReadingTime</span>

    <% loop $Testimonials %>
        <blockquote>
            <p>$Quote</p>
            <cite>$Author</cite>
            <small>$Up.Subtitle</small>
        </blockquote>
    <% end_loop %>

    <% include Navigation %>
    <% include Footer %>

    <img src="{$HeroImage.Fill(400,300).URL}" alt="{$HeroImage.Title.ATT}">
</div>
